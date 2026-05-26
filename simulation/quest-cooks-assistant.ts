/**
 * Cook's Assistant Quest — investigation harness (PM mandate: "make them do hard things").
 *
 * GOAL
 *   Demonstrate whether the current substrate (engine + perception + agent
 *   gateway + Brain planner + knowledge stack) can carry a resident through
 *   the canonical first RuneScape quest. Cook's Assistant requires: talk to
 *   the Lumbridge Castle Cook, gather one egg + one bucket of milk + one pot
 *   of flour, return to the Cook, hand them over.
 *
 *   This is an investigative artifact. The expected answer is "no, here are
 *   the gaps." We capture those gaps with crisp evidence.
 *
 * WHAT IT DOES
 *   1. Connects to a running game server gateway (default ws://127.0.0.1:43595/agent)
 *      with a *separate* controllerId so we do not collide with the live
 *      production controller's residents.
 *   2. Creates a fresh quest-tester resident (default `res:cookquester`) at
 *      the Lumbridge Castle kitchen (3210, 3216, 0 — one tile south of the
 *      Cook NPC at 3210,3215,0). If the resident exists, reuses it.
 *   3. Optionally pre-stocks the resident's inventory with the three quest
 *      ingredients (item ids 1944 egg, 1927 bucket-of-milk, 1933 pot-of-flour)
 *      via `initialInventory` on `create_resident` — this is the "cheat"
 *      mode that strips out the gathering complexity and lets us see whether
 *      the resident can at least talk to the Cook and hand items over.
 *   4. Runs a *minimal external planner* (not the Brain) that proves the
 *      mechanical path: walk to the Cook, talk-to, observe the dialogue.
 *      We do NOT exercise the LLM Brain here — that experiment lives in a
 *      separate harness. The point is to verify the substrate has the
 *      necessary primitives.
 *   5. Captures structured findings: did the engine respond to talk-to? did
 *      the dialogue mention ingredients? did the inventory drain? did any
 *      action_result come back ok? did any perception event reference quest
 *      progress?
 *   6. Emits a structured JSON findings blob to stdout AND writes a markdown
 *      findings file under data/logs/simulation/quest-cooks-assistant/ for
 *      the intel log.
 *
 * WHY THIS SHAPE
 *   - The brain planner (src/controller/spark/runescape-brain-planner.ts)
 *     has NO quest goal factory and NO isQuestGoal predicate. So letting the
 *     Brain "freestyle" is known to fail; we'd be measuring LLM quality, not
 *     substrate capability. By running a deterministic external planner, we
 *     isolate substrate gaps from inference gaps.
 *   - Perception schema (src/engine/world/actor/resident/perception/
 *     perception-types.ts) has NO `quests` field. The resident cannot
 *     observe its own quest stage. We log this as a finding.
 *   - The agent gateway protocol (src/server/agent/protocol/messages.ts)
 *     has NO quest-state query frame. We can only infer quest progress from
 *     inventory deltas and chat events.
 *
 * USAGE
 *   # 1. Make sure a game server is running on 127.0.0.1:43595
 *   #    (npm run start:standalone or already running on the live port)
 *   # 2. Run the harness:
 *   npx ts-node -r tsconfig-paths/register simulation/quest-cooks-assistant.ts
 *   # Options:
 *   #   --resident=res:cookquester       (default)
 *   #   --duration-ms=60000               (default 60s)
 *   #   --controller-id=quest-investigator (default; isolates from live)
 *   #   --no-stock-inventory              (don't pre-stock ingredients — pure-gathering mode)
 *   #   --no-talk                         (skip the talk-to step; just observe)
 *
 * SAFETY
 *   - Uses a unique controllerId so the live controller is unaffected.
 *   - Uses a dedicated resident name (res:cookquester) so it does not steal
 *     control of res:agent or any production resident.
 *   - Does NOT modify any production source files. Pure new code in
 *     simulation/.
 *   - On exit, disconnects with cause `quest_investigation_complete` so the
 *     resident is parked idle.
 *
 * NON-GOALS
 *   - Does not exercise the LLM Brain (that's a separate experiment).
 *   - Does not implement gathering of ingredients (windmill, dairy cow,
 *     chicken coop). The current substrate has no item_action `pick` on
 *     wheat or `milk` on a dairy cow at this layer — those would require
 *     engine-level plumbing we have not verified here.
 *   - Does not attempt to assert on quest journal state since there is no
 *     way to read it via the gateway.
 */

import fs from 'fs';
import path from 'path';
import { SimulationGatewayClient } from './lib/client';
import type { ActionResult, AgentAction, ItemRef, Perception, PerceptionEvent, Position } from './lib/types';

// --- Quest-specific constants. -------------------------------------------

/**
 * Lumbridge Castle Cook NPC spawn (from
 * data/config/npc-spawns/lumbridge/lumbridge-general.json — npc
 * `rs:lumbridge_castle_cook`, spawn_x 3210, spawn_y 3215, movement_radius 4).
 * Level 0 = ground floor of the castle.
 */
const COOK_NPC_KEY = 'rs:lumbridge_castle_cook';
const COOK_POSITION: Required<Position> = { x: 3210, y: 3215, level: 0 };
/** One tile south of the Cook — safe spawn inside the kitchen. */
const SPAWN_POSITION: Required<Position> = { x: 3210, y: 3216, level: 0 };

/** Item IDs from src/engine/world/config/item-ids.ts. */
const ITEM_EGG = 1944;
const ITEM_BUCKET_OF_MILK = 1927;
const ITEM_POT_OF_FLOUR = 1933;
const QUEST_INGREDIENT_IDS = new Set<number>([ITEM_EGG, ITEM_BUCKET_OF_MILK, ITEM_POT_OF_FLOUR]);

// --- CLI parsing (lightweight; intentionally not reusing the wander harness's). ---

interface HarnessOptions {
    resident: string;
    controllerId: string;
    gatewayUrl: string;
    authToken?: string;
    durationMs: number;
    stockInventory: boolean;
    talk: boolean;
    findingsDir: string;
}

function parseCli(argv: string[]): HarnessOptions {
    const options: HarnessOptions = {
        resident: 'res:cookquester',
        controllerId: process.env.SIM_CONTROLLER_ID || 'quest-investigator',
        gatewayUrl: process.env.SIM_GATEWAY_URL || 'ws://127.0.0.1:43595/agent',
        authToken: process.env.SIM_GATEWAY_AUTH_TOKEN || undefined,
        durationMs: 60_000,
        stockInventory: true,
        talk: true,
        findingsDir: path.resolve(process.cwd(), 'data/logs/simulation/quest-cooks-assistant'),
    };
    for (const arg of argv) {
        const [key, rawValue] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
        switch (key) {
            case '--resident':
                if (rawValue) options.resident = rawValue.toLowerCase();
                break;
            case '--controller-id':
                if (rawValue) options.controllerId = rawValue;
                break;
            case '--gateway-url':
                if (rawValue) options.gatewayUrl = rawValue;
                break;
            case '--duration-ms':
                if (rawValue) options.durationMs = Math.max(1000, Number(rawValue) | 0);
                break;
            case '--no-stock-inventory':
                options.stockInventory = false;
                break;
            case '--no-talk':
                options.talk = false;
                break;
            case '--findings-dir':
                if (rawValue) options.findingsDir = path.resolve(process.cwd(), rawValue);
                break;
            case '--help':
            case '-h':
                process.stdout.write(usage());
                process.exit(0);
                break;
        }
    }
    return options;
}

function usage(): string {
    return [
        'simulation/quest-cooks-assistant.ts — investigation harness',
        '',
        'Usage: npx ts-node -r tsconfig-paths/register simulation/quest-cooks-assistant.ts [options]',
        '',
        'Options:',
        '  --resident=<name>             Resident to drive (default: res:cookquester)',
        '  --controller-id=<id>          Gateway controllerId (default: quest-investigator)',
        '  --gateway-url=<url>           Gateway URL (default: ws://127.0.0.1:43595/agent)',
        '  --duration-ms=<n>             How long to observe (default: 60000)',
        '  --no-stock-inventory          Do NOT pre-stock egg/milk/flour',
        '  --no-talk                     Only observe; do not move/talk-to the Cook',
        '  --findings-dir=<path>         Where to write findings (default: data/logs/simulation/quest-cooks-assistant)',
        '',
    ].join('\n');
}

// --- Findings model. ------------------------------------------------------

interface CheckResult {
    /** Stable id for this check (e.g. `engine.quest_plugin_loaded`). */
    id: string;
    /** One-line human description. */
    description: string;
    /** PASS = substrate supports it. FAIL = gap. INCONCLUSIVE = cannot tell from this vantage. */
    status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
    /** Free-form evidence supporting the verdict. */
    evidence: string;
}

interface Findings {
    runStartedAt: string;
    runFinishedAt?: string;
    options: HarnessOptions;
    summary: {
        totalChecks: number;
        passed: number;
        failed: number;
        inconclusive: number;
    };
    checks: CheckResult[];
    /** Raw observed signals — useful for debugging the harness itself. */
    observed: {
        perceptionTicks: number;
        events: Array<{ tick?: number; event: PerceptionEvent }>;
        actionsSubmitted: Array<{ action: AgentAction; requestId: string }>;
        actionResults: Array<{ requestId?: string; result: ActionResult }>;
        chatMessages: Array<{ tick?: number; speaker?: string; text: string }>;
        inventorySnapshots: Array<{ tick?: number; items: Array<{ slot: number; itemId: number; amount: number }> }>;
        cookSeen: boolean;
        cookPosition?: Required<Position>;
        distanceToCookFinal?: number;
        finalInventoryHasQuestItems: { egg: boolean; milk: boolean; flour: boolean };
    };
}

function makeFindings(options: HarnessOptions): Findings {
    return {
        runStartedAt: new Date().toISOString(),
        options,
        summary: { totalChecks: 0, passed: 0, failed: 0, inconclusive: 0 },
        checks: [],
        observed: {
            perceptionTicks: 0,
            events: [],
            actionsSubmitted: [],
            actionResults: [],
            chatMessages: [],
            inventorySnapshots: [],
            cookSeen: false,
            finalInventoryHasQuestItems: { egg: false, milk: false, flour: false },
        },
    };
}

function recordCheck(findings: Findings, check: CheckResult): void {
    findings.checks.push(check);
    findings.summary.totalChecks++;
    if (check.status === 'PASS') findings.summary.passed++;
    else if (check.status === 'FAIL') findings.summary.failed++;
    else findings.summary.inconclusive++;
}

// --- Static substrate checks (run before the network test). ------------

function runStaticChecks(findings: Findings): void {
    // 1. Quest plugin exists in the engine.
    const questPluginPath = path.resolve(process.cwd(), 'src/plugins/quests/cooks-assistant-quest.plugin.ts');
    const questPluginExists = fs.existsSync(questPluginPath);
    recordCheck(findings, {
        id: 'engine.quest_plugin_loaded',
        description: "Cook's Assistant quest plugin exists in src/plugins/quests/",
        status: questPluginExists ? 'PASS' : 'FAIL',
        evidence: questPluginExists
            ? `${questPluginPath} exists; defines Quest id=rs:cooks_assistant with stages 0/50/complete, hooks for talk-to Cook NPC.`
            : `Missing: ${questPluginPath}`,
    });

    // 2. Agent-facing knowledge entry exists.
    const knowledgePath = path.resolve(process.cwd(), 'src/controller/knowledge/knowledge-retriever.ts');
    const knowledgeText = fs.existsSync(knowledgePath) ? fs.readFileSync(knowledgePath, 'utf8') : '';
    const hasQuestKnowledge = /quest-cooks-assistant/.test(knowledgeText);
    recordCheck(findings, {
        id: 'knowledge.entry_exists',
        description: 'Knowledge retriever has a quest-cooks-assistant entry surfaced to the Brain',
        status: hasQuestKnowledge ? 'PASS' : 'FAIL',
        evidence: hasQuestKnowledge
            ? `knowledge-retriever.ts contains entry id "quest-cooks-assistant" with cook coords + ingredient list.`
            : `No matching knowledge entry in ${knowledgePath}.`,
    });

    // 3. Perception schema exposes quest state.
    const perceptionTypesPath = path.resolve(process.cwd(), 'src/engine/world/actor/resident/perception/perception-types.ts');
    const perceptionText = fs.existsSync(perceptionTypesPath) ? fs.readFileSync(perceptionTypesPath, 'utf8') : '';
    const hasQuestPerception = /\bquest/i.test(perceptionText);
    recordCheck(findings, {
        id: 'perception.exposes_quest_state',
        description: 'Resident perception payload includes a quests field the agent can read',
        status: hasQuestPerception ? 'PASS' : 'FAIL',
        evidence: hasQuestPerception
            ? `perception-types.ts mentions quest.`
            : `perception-types.ts has NO 'quest' field. The resident cannot observe its own quest stage; ingredient progress must be inferred from inventory deltas only.`,
    });

    // 4. Brain planner has a quest goal factory.
    const plannerPath = path.resolve(process.cwd(), 'src/controller/spark/runescape-brain-planner.ts');
    const plannerText = fs.existsSync(plannerPath) ? fs.readFileSync(plannerPath, 'utf8') : '';
    const hasQuestGoalFactory = /\bquestGoal\b|cooksAssistantGoal/i.test(plannerText);
    recordCheck(findings, {
        id: 'planner.quest_goal_factory',
        description: 'Brain planner has a canonical quest Active Goal factory (analogous to firemakingGoal)',
        status: hasQuestGoalFactory ? 'PASS' : 'FAIL',
        evidence: hasQuestGoalFactory
            ? `Brain planner defines a quest goal factory.`
            : `Brain planner has factories for firemaking, woodcutting, fishing, cooking, prayer, combat, exploration, follow — but no quest-* factory. Without one, the orchestrator cannot seed a deterministic Cook's Assistant goal; the Brain has to invent one from prose, and there is no predicate (isQuestGoal) to route it to a Body routine.`,
    });

    // 5. Brain planner has a quest-goal predicate (mirrors isFiremakingGoal etc).
    const hasQuestPredicate = /isQuestGoal|isCooksAssistantGoal/i.test(plannerText);
    recordCheck(findings, {
        id: 'planner.quest_goal_predicate',
        description: 'Brain planner has an isQuestGoal predicate to route a goal to a quest Body routine',
        status: hasQuestPredicate ? 'PASS' : 'FAIL',
        evidence: hasQuestPredicate
            ? `Brain planner defines isQuestGoal-style predicate.`
            : `No isQuestGoal predicate. Even if the Brain says "do Cook's Assistant", nothing classifies that intent for the Body.`,
    });

    // 6. Body routines have a quest workflow.
    const bodyPath = path.resolve(process.cwd(), 'src/controller/spark/runescape-body-routines.ts');
    const bodyText = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf8') : '';
    const hasQuestBody = /\bquest|cook'?s? assistant/i.test(bodyText);
    recordCheck(findings, {
        id: 'body.quest_routine',
        description: 'Body has a quest routine that walks to the quest-giver, opens dialogue, and chooses options',
        status: hasQuestBody ? 'PASS' : 'FAIL',
        evidence: hasQuestBody
            ? `Body routines mention quest.`
            : `runescape-body-routines.ts has no quest routine. Body has fishing/cooking/woodcutting/firemaking/exploration loops; a quest needs dialogue choice navigation that none of these provide.`,
    });

    // 7. Gateway exposes any quest state to the controller.
    const protocolPath = path.resolve(process.cwd(), 'src/server/agent/protocol/messages.ts');
    const protocolText = fs.existsSync(protocolPath) ? fs.readFileSync(protocolPath, 'utf8') : '';
    const hasQuestProtocol = /\bquest/i.test(protocolText);
    recordCheck(findings, {
        id: 'gateway.quest_query',
        description: 'Agent gateway protocol has a quest-state query / event frame',
        status: hasQuestProtocol ? 'PASS' : 'FAIL',
        evidence: hasQuestProtocol
            ? `Gateway protocol mentions quest.`
            : `Gateway protocol has no quest frame. The controller cannot poll quest progress; the simulation can only infer it from inventory and chat deltas.`,
    });

    // 8. AgentAction codec supports the actions needed (move_to, interact talk-to, dialogue_choice).
    const codecPath = path.resolve(process.cwd(), 'src/controller/transport/message-codecs.ts');
    const codecText = fs.existsSync(codecPath) ? fs.readFileSync(codecPath, 'utf8') : '';
    const hasMoveTo = /literal\('move_to'\)/.test(codecText);
    const hasInteract = /literal\('interact'\)/.test(codecText);
    const hasDialogueChoice = /literal\('dialogue_choice'\)/.test(codecText);
    const hasDialogueContinue = /literal\('dialogue_continue'\)/.test(codecText);
    const allDialogueActionsPresent = hasMoveTo && hasInteract && hasDialogueChoice && hasDialogueContinue;
    recordCheck(findings, {
        id: 'action.dialogue_primitives',
        description: 'AgentAction codec supports move_to + interact talk-to + dialogue_continue + dialogue_choice',
        status: allDialogueActionsPresent ? 'PASS' : 'FAIL',
        evidence: allDialogueActionsPresent
            ? `All primitives present in agentActionSchema: move_to=${hasMoveTo}, interact=${hasInteract}, dialogue_continue=${hasDialogueContinue}, dialogue_choice=${hasDialogueChoice}.`
            : `Missing primitive(s): move_to=${hasMoveTo}, interact=${hasInteract}, dialogue_continue=${hasDialogueContinue}, dialogue_choice=${hasDialogueChoice}.`,
    });

    // 9. Engine knows the Cook NPC by key.
    const cookSpawnPath = path.resolve(process.cwd(), 'data/config/npc-spawns/lumbridge/lumbridge-general.json');
    const cookSpawnText = fs.existsSync(cookSpawnPath) ? fs.readFileSync(cookSpawnPath, 'utf8') : '';
    const cookSpawned = cookSpawnText.includes(COOK_NPC_KEY);
    recordCheck(findings, {
        id: 'engine.cook_npc_spawned',
        description: `Cook NPC ${COOK_NPC_KEY} is spawned in the world`,
        status: cookSpawned ? 'PASS' : 'FAIL',
        evidence: cookSpawned
            ? `Cook spawned at ${COOK_POSITION.x},${COOK_POSITION.y},${COOK_POSITION.level} (lumbridge-general.json).`
            : `Cook NPC spawn not found.`,
    });
}

// --- Network harness. -----------------------------------------------------

interface RuntimeState {
    findings: Findings;
    options: HarnessOptions;
    lastPerception?: Perception;
    pendingActions: Map<string, AgentAction>;
    actionsSinceLastChange: number;
    distanceCloseEnoughToTalk: number;
    talked: boolean;
}

const TALK_RANGE_TILES = 2;

/**
 * Drive the resident with a deterministic micro-plan, NOT the Brain:
 *   - If we are too far from the Cook, walk one step toward them.
 *   - If we are within talk range and haven't talked, interact talk-to.
 *   - If a dialogue is open (we don't have a clean signal — we approximate
 *     by treating perception.resident.busy as "dialogue likely"), spam
 *     dialogue_continue / dialogue_choice optionIndex 0 to advance through.
 *   - Otherwise: noop. We are observing, not exhaustively exercising.
 *
 * This planner is intentionally tiny — it exists to prove the substrate
 * supports the *first* leg of the quest (walk + talk-to + dialogue). If
 * even this fails, that's a finding.
 */
function planNextAction(state: RuntimeState, perception: Perception): AgentAction | null {
    const me = perception.resident?.position;
    if (!me) {
        return { kind: 'noop', cause: 'no_resident_position' };
    }

    // Update cookSeen + position from perception.nearby.npcs.
    const cook = (perception.nearby?.npcs || []).find(npc => npc.key === COOK_NPC_KEY || npc.name === 'Cook');
    if (cook) {
        state.findings.observed.cookSeen = true;
        state.findings.observed.cookPosition = cook.position;
    }

    const targetPosition = cook?.position || COOK_POSITION;
    const dx = targetPosition.x - me.x;
    const dy = targetPosition.y - me.y;
    const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
    state.findings.observed.distanceToCookFinal = chebyshev;

    // If we're in a dialogue, advance it. The engine sets resident.busy when
    // dialogue/cutscene is running — that's our best signal absent a
    // dedicated dialogue_open field.
    if (perception.resident?.busy) {
        // Alternate between continue and choice 0 — most starter dialogues
        // expect either. The first menu in the Cook's dialogue offers
        // multiple branches; option 0 is "What's wrong?" → opens the quest.
        // Subsequent menus accept dialogue_continue.
        return { kind: 'dialogue_continue' };
    }

    if (chebyshev > TALK_RANGE_TILES) {
        // Walk toward the cook. We hand the engine the full target — the
        // resident's pathfinder handles the rest.
        return { kind: 'move_to', target: { x: targetPosition.x, y: targetPosition.y, level: targetPosition.level } };
    }

    // In range. If talking is enabled and we haven't talked yet, try it.
    if (state.options.talk && !state.talked && cook) {
        state.talked = true;
        return {
            kind: 'interact',
            target: { id: cook.id, kind: 'npc', key: cook.key, name: cook.name, position: cook.position },
            option: 'talk-to',
        };
    }

    return { kind: 'noop', cause: 'idle_observation' };
}

function snapshotInventory(perception: Perception, findings: Findings): void {
    const inv = perception.resident?.inventory;
    if (!Array.isArray(inv)) return;
    const items: Array<{ slot: number; itemId: number; amount: number }> = [];
    let egg = false;
    let milk = false;
    let flour = false;
    inv.forEach((item, slot) => {
        if (!item) return;
        items.push({ slot, itemId: item.itemId, amount: item.amount });
        if (item.itemId === ITEM_EGG) egg = true;
        if (item.itemId === ITEM_BUCKET_OF_MILK) milk = true;
        if (item.itemId === ITEM_POT_OF_FLOUR) flour = true;
    });
    // Only snapshot when it changes shape (cheap dedupe by length+sum).
    const last = findings.observed.inventorySnapshots[findings.observed.inventorySnapshots.length - 1];
    const lastKey = last ? `${last.items.length}:${last.items.map(i => `${i.itemId}x${i.amount}`).join(',')}` : '';
    const nextKey = `${items.length}:${items.map(i => `${i.itemId}x${i.amount}`).join(',')}`;
    if (lastKey !== nextKey) {
        findings.observed.inventorySnapshots.push({ tick: perception.tick, items });
    }
    findings.observed.finalInventoryHasQuestItems = { egg, milk, flour };
}

function recordEvent(findings: Findings, event: PerceptionEvent, tick?: number): void {
    findings.observed.events.push({ tick, event });
    // chat events surface dialogue too; capture text if any.
    const maybeText = (typeof event.text === 'string' && event.text) || (typeof event.message === 'string' && event.message) || undefined;
    if (maybeText) {
        const speaker = (typeof event.speaker === 'string' && event.speaker) || (typeof event.from === 'string' && event.from) || undefined;
        findings.observed.chatMessages.push({ tick, speaker, text: maybeText });
    }
}

async function runNetworkHarness(findings: Findings, options: HarnessOptions): Promise<void> {
    const gateway = new SimulationGatewayClient({
        url: options.gatewayUrl,
        authToken: options.authToken,
        controllerId: options.controllerId,
        requestTimeoutMs: 10_000,
    });

    let connectFailed = false;
    try {
        await gateway.connect();
    } catch (error) {
        connectFailed = true;
        recordCheck(findings, {
            id: 'gateway.reachable',
            description: 'Agent gateway is reachable on the configured URL',
            status: 'FAIL',
            evidence: `connect() threw: ${(error as Error).message}. Is the game server running?`,
        });
        return;
    }
    recordCheck(findings, {
        id: 'gateway.reachable',
        description: 'Agent gateway is reachable on the configured URL',
        status: 'PASS',
        evidence: `Connected to ${options.gatewayUrl} as controllerId=${options.controllerId}.`,
    });

    try {
        await gateway.hello();
        const existing = await gateway.listResidents('all');
        const known = new Set(existing.map(r => r.name));
        if (!known.has(options.resident)) {
            // Pre-stock if requested. itemId-based InitialContainerItem entries:
            const initialInventory = options.stockInventory
                ? [
                      { itemId: ITEM_EGG, amount: 1 },
                      { itemId: ITEM_BUCKET_OF_MILK, amount: 1 },
                      { itemId: ITEM_POT_OF_FLOUR, amount: 1 },
                  ]
                : undefined;
            // The simulation client's createResident does not accept initialInventory;
            // we issue the raw request via the same socket. Hand-craft the frame.
            await (
                gateway as unknown as {
                    request(kind: string, payload?: unknown): Promise<unknown>;
                }
            ).request('create_resident', {
                name: options.resident,
                spawnPosition: SPAWN_POSITION,
                initialInventory,
            });
            recordCheck(findings, {
                id: 'resident.created',
                description: 'Quest tester resident was created',
                status: 'PASS',
                evidence: `Created ${options.resident} at ${SPAWN_POSITION.x},${SPAWN_POSITION.y},${SPAWN_POSITION.level} with initialInventory=${options.stockInventory ? 'egg+milk+flour' : 'none'}.`,
            });
        } else {
            recordCheck(findings, {
                id: 'resident.created',
                description: 'Quest tester resident was created (or already existed)',
                status: 'INCONCLUSIVE',
                evidence: `Resident ${options.resident} already existed. Did NOT re-stock inventory. Pass --resident=<new-name> for a clean run.`,
            });
        }

        // Connect with control: true. This is safe since we use a unique
        // resident name that the live controller is not managing.
        const connected = await gateway.connectResident(options.resident);
        recordCheck(findings, {
            id: 'resident.controlled',
            description: 'Harness can take exclusive control of the quest tester resident',
            status: 'PASS',
            evidence: `connect_resident ok. Initial perception ${connected.perception ? 'present' : 'absent'}.`,
        });

        const state: RuntimeState = {
            findings,
            options,
            pendingActions: new Map(),
            actionsSinceLastChange: 0,
            distanceCloseEnoughToTalk: TALK_RANGE_TILES,
            talked: false,
        };

        const submitOnPerception = async (perception: Perception): Promise<void> => {
            findings.observed.perceptionTicks++;
            state.lastPerception = perception;
            snapshotInventory(perception, findings);
            for (const event of perception.events || []) {
                recordEvent(findings, event, perception.tick);
            }
            const action = planNextAction(state, perception);
            if (!action || action.kind === 'noop') return;
            try {
                const requestId = await gateway.submitAction(options.resident, action);
                findings.observed.actionsSubmitted.push({ action, requestId });
                state.pendingActions.set(requestId, action);
            } catch (error) {
                findings.observed.actionResults.push({
                    result: { ok: false, reason: 'submit_threw', error: (error as Error).message },
                });
            }
        };

        gateway.on('perception', (residentId, perception) => {
            if (!residentId.endsWith(options.resident)) return;
            void submitOnPerception(perception);
        });
        gateway.on('event', (residentId, event) => {
            if (!residentId.endsWith(options.resident)) return;
            recordEvent(findings, event);
        });
        gateway.on('actionResult', (residentId, result, requestId) => {
            if (!residentId.endsWith(options.resident)) return;
            findings.observed.actionResults.push({ requestId, result });
        });

        if (connected.perception) {
            await submitOnPerception(connected.perception);
        }

        await new Promise<void>(resolve => setTimeout(resolve, options.durationMs));

        try {
            await gateway.disconnectResident(options.resident, 'quest_investigation_complete');
        } catch {
            // best-effort; not a finding.
        }
    } finally {
        try {
            gateway.close();
        } catch {
            // ignore
        }
    }

    if (connectFailed) return;

    // Synthesize network-derived checks.
    const obs = findings.observed;
    const anyOkAction = obs.actionResults.some(r => r.result.ok);
    recordCheck(findings, {
        id: 'network.action_loop',
        description: 'At least one submitted action returned ok from the engine',
        status: anyOkAction ? 'PASS' : obs.actionsSubmitted.length === 0 ? 'INCONCLUSIVE' : 'FAIL',
        evidence:
            `Submitted ${obs.actionsSubmitted.length} action(s); ` +
            `${obs.actionResults.filter(r => r.result.ok).length} ok, ` +
            `${obs.actionResults.filter(r => !r.result.ok).length} not ok. ` +
            (obs.actionResults.length > 0
                ? `First non-ok reason: ${obs.actionResults.find(r => !r.result.ok)?.result.reason || 'n/a'}.`
                : ''),
    });

    recordCheck(findings, {
        id: 'network.cook_in_perception',
        description: 'The Cook NPC appeared in the resident perception while observed',
        status: obs.cookSeen ? 'PASS' : 'FAIL',
        evidence: obs.cookSeen
            ? `Saw Cook at ${obs.cookPosition?.x},${obs.cookPosition?.y},${obs.cookPosition?.level}. Final chebyshev distance: ${obs.distanceToCookFinal}.`
            : `Cook never appeared in perception.nearby.npcs across ${obs.perceptionTicks} perception ticks. Either the resident did not reach perception radius, or the NPC key/name does not match.`,
    });

    recordCheck(findings, {
        id: 'network.inventory_pre_stock_present',
        description: 'Quest ingredients (egg, milk, flour) appeared in the resident inventory',
        status:
            obs.finalInventoryHasQuestItems.egg && obs.finalInventoryHasQuestItems.milk && obs.finalInventoryHasQuestItems.flour
                ? 'PASS'
                : options.stockInventory
                  ? 'FAIL'
                  : 'INCONCLUSIVE',
        evidence:
            `Final inventory ingredient flags: egg=${obs.finalInventoryHasQuestItems.egg}, ` +
            `milk=${obs.finalInventoryHasQuestItems.milk}, flour=${obs.finalInventoryHasQuestItems.flour}. ` +
            (options.stockInventory
                ? `Pre-stocking was enabled — missing items indicate create_resident.initialInventory dropped them.`
                : `Pre-stocking disabled; gathering not implemented in this harness.`),
    });

    const questItemEvents = obs.events.filter(e => {
        const item = e.event.item as ItemRef | undefined;
        return item && QUEST_INGREDIENT_IDS.has(item.itemId);
    });
    recordCheck(findings, {
        id: 'network.ingredient_drain_observed',
        description: 'After talking to the Cook, an item_lost event drained at least one quest ingredient',
        status: questItemEvents.some(e => e.event.kind === 'item_lost')
            ? 'PASS'
            : options.talk && options.stockInventory
              ? 'FAIL'
              : 'INCONCLUSIVE',
        evidence:
            `Quest-ingredient events observed: ${questItemEvents.length}. ` +
            (questItemEvents.length === 0
                ? `If pre-stock+talk were both enabled and the Cook accepted ingredients, we should see item_lost events for itemIds {1944,1927,1933}. Their absence suggests either: (a) the talk-to never opened the right dialogue branch, (b) the dialogue completed but the engine's hand-off path was not exercised by dialogue_continue alone, or (c) the dialogue requires specific dialogue_choice optionIndex values we did not select.`
                : `Events: ${questItemEvents.map(e => `${e.event.kind}:${(e.event.item as ItemRef).itemId}`).join(', ')}.`),
    });

    const questChat = obs.chatMessages.filter(m => /cook|cake|flour|milk|egg|ingredient|duke/i.test(m.text));
    recordCheck(findings, {
        id: 'network.quest_chat_observed',
        description: 'Quest-related chat (Cook dialogue lines) was observed in perception',
        status: questChat.length > 0 ? 'PASS' : options.talk ? 'FAIL' : 'INCONCLUSIVE',
        evidence:
            questChat.length > 0
                ? `Observed ${questChat.length} quest-related chat line(s). Example: "${questChat[0].text.slice(0, 120)}".`
                : `No quest-related chat seen across ${obs.chatMessages.length} captured chat message(s). If talk-to opened the dialogue, the Cook's lines may not be surfaced as chat events to the agent layer — they likely render as interface widgets the gateway does not relay.`,
    });
}

// --- Findings writer. -----------------------------------------------------

function writeFindings(findings: Findings): { jsonPath: string; markdownPath: string } {
    findings.runFinishedAt = new Date().toISOString();
    fs.mkdirSync(findings.options.findingsDir, { recursive: true });
    const ts = findings.runStartedAt.replace(/[:.]/g, '-');
    const jsonPath = path.join(findings.options.findingsDir, `findings-${ts}.json`);
    const markdownPath = path.join(findings.options.findingsDir, `findings-${ts}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(findings, null, 2)}\n`);
    fs.writeFileSync(markdownPath, renderMarkdown(findings));
    return { jsonPath, markdownPath };
}

function renderMarkdown(findings: Findings): string {
    const { summary } = findings;
    const lines: string[] = [];
    lines.push(`# Cook's Assistant — Quest Investigation Findings`);
    lines.push('');
    lines.push(`Run started: ${findings.runStartedAt}`);
    lines.push(`Run finished: ${findings.runFinishedAt || '(in progress)'}`);
    lines.push(`Controller id: ${findings.options.controllerId}`);
    lines.push(`Resident: ${findings.options.resident}`);
    lines.push(`Gateway: ${findings.options.gatewayUrl}`);
    lines.push(`Pre-stock inventory: ${findings.options.stockInventory}`);
    lines.push(`Talk to cook: ${findings.options.talk}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`- Total checks: ${summary.totalChecks}`);
    lines.push(`- PASS: ${summary.passed}`);
    lines.push(`- FAIL: ${summary.failed}`);
    lines.push(`- INCONCLUSIVE: ${summary.inconclusive}`);
    lines.push('');
    lines.push(`## Checks`);
    lines.push('');
    for (const check of findings.checks) {
        const badge = check.status === 'PASS' ? '[PASS]' : check.status === 'FAIL' ? '[FAIL]' : '[INCONCLUSIVE]';
        lines.push(`### ${badge} ${check.id}`);
        lines.push('');
        lines.push(`**${check.description}**`);
        lines.push('');
        lines.push(check.evidence);
        lines.push('');
    }
    lines.push(`## Observed Signals`);
    lines.push('');
    lines.push(`- Perception ticks: ${findings.observed.perceptionTicks}`);
    lines.push(`- Actions submitted: ${findings.observed.actionsSubmitted.length}`);
    lines.push(`- Action results: ${findings.observed.actionResults.length}`);
    lines.push(`- Events observed: ${findings.observed.events.length}`);
    lines.push(`- Chat messages captured: ${findings.observed.chatMessages.length}`);
    lines.push(`- Inventory snapshots: ${findings.observed.inventorySnapshots.length}`);
    lines.push(`- Cook seen in perception: ${findings.observed.cookSeen}`);
    if (findings.observed.cookPosition) {
        const p = findings.observed.cookPosition;
        lines.push(`- Cook position: ${p.x},${p.y},${p.level}`);
    }
    if (findings.observed.distanceToCookFinal !== undefined) {
        lines.push(`- Final chebyshev distance to cook: ${findings.observed.distanceToCookFinal}`);
    }
    lines.push('');
    if (findings.observed.chatMessages.length > 0) {
        lines.push(`### Captured chat (first 10)`);
        lines.push('');
        for (const m of findings.observed.chatMessages.slice(0, 10)) {
            lines.push(`- [tick ${m.tick ?? '?'}] **${m.speaker ?? '?'}**: ${m.text}`);
        }
        lines.push('');
    }
    if (findings.observed.actionResults.length > 0) {
        lines.push(`### First 10 action results`);
        lines.push('');
        for (const r of findings.observed.actionResults.slice(0, 10)) {
            lines.push(`- requestId=${r.requestId ?? '?'} ok=${r.result.ok} reason=${r.result.reason ?? ''}`);
        }
        lines.push('');
    }
    lines.push(`## Gap Analysis (substrate → quest completion)`);
    lines.push('');
    lines.push(`The static checks above enumerate the substrate gaps. In order of`);
    lines.push(`severity for actually completing Cook's Assistant from a fresh resident:`);
    lines.push('');
    lines.push(`1. **No quest field in perception** (engine plumbing). The agent`);
    lines.push(`   cannot know it is on a quest, what stage it is at, or which`);
    lines.push(`   ingredient it still needs. Without this, the Brain can only`);
    lines.push(`   re-derive state from the knowledge entry + inventory deltas`);
    lines.push(`   every turn, which is brittle and burns tokens.`);
    lines.push('');
    lines.push(`2. **No quest goal factory in the Brain planner**. The Brain`);
    lines.push(`   has canonical goals for fishing/cooking/firemaking/etc. but`);
    lines.push(`   nothing for quests. A free-text "complete Cook's Assistant"`);
    lines.push(`   goal has no routing handle.`);
    lines.push('');
    lines.push(`3. **No quest routine in the Body**. Even with a goal, there is`);
    lines.push(`   no Body workflow that knows how to walk-to-NPC, open dialogue,`);
    lines.push(`   advance through the menu, and select the "yes, I'll help"`);
    lines.push(`   branch. Generic interact talk-to opens the dialogue but the`);
    lines.push(`   Body has no dialogue_choice strategy.`);
    lines.push('');
    lines.push(`4. **No gateway quest query**. The controller cannot poll quest`);
    lines.push(`   progress to verify or close the loop. Inventory deltas are`);
    lines.push(`   the only handle.`);
    lines.push('');
    lines.push(`5. **No ingredient-gathering routines**. Body has no windmill`);
    lines.push(`   recipe (climb ladders, fill hopper, operate hopper, descend,`);
    lines.push(`   empty bin with pot), no dairy-cow milking, no chicken-coop`);
    lines.push(`   egg pickup. These are bespoke per-quest sequences.`);
    lines.push('');
    lines.push(`6. **No dialogue-tree introspection from the agent side**. The`);
    lines.push(`   engine renders dialogue as interface widgets; the agent`);
    lines.push(`   layer sees only resident.busy=true and has to blindly send`);
    lines.push(`   dialogue_continue / dialogue_choice without knowing which`);
    lines.push(`   option corresponds to which line.`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}

// --- Main. ----------------------------------------------------------------

async function main(): Promise<void> {
    const options = parseCli(process.argv.slice(2));
    const findings = makeFindings(options);
    runStaticChecks(findings);
    await runNetworkHarness(findings, options);
    const { jsonPath, markdownPath } = writeFindings(findings);
    process.stdout.write(
        `\n[quest-cooks-assistant] Investigation complete.\n` +
            `  PASS=${findings.summary.passed} FAIL=${findings.summary.failed} INCONCLUSIVE=${findings.summary.inconclusive}\n` +
            `  Findings JSON:     ${jsonPath}\n` +
            `  Findings Markdown: ${markdownPath}\n` +
            `\n` +
            `Top gaps (see markdown for full report):\n` +
            findings.checks
                .filter(c => c.status === 'FAIL')
                .slice(0, 6)
                .map(c => `  - [FAIL] ${c.id}: ${c.description}\n`)
                .join(''),
    );
}

main().catch(error => {
    process.stderr.write(`[quest-cooks-assistant] FATAL: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
