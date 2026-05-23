import type { ActiveGoalState } from '../memory/runtime-state';
import type { ActionAttempt } from '../actions/action-attempt';
import type { Perception } from '../transport/message-codecs';
import {
    ENGINE_KNOWLEDGE_ENTRIES,
    type KnowledgeEntry,
    type KnowledgeResult,
    formatKnowledgeForPrompt,
    retrieveKnowledge,
} from './knowledge-retriever';
import { type KnowledgeSuggestion, knowledgeSuggestionDedupKey } from './suggestions';
import { derivePerceptionContext, deriveGoalContext } from './context-derivation';

export type WorkflowAvailabilityStatus = 'can_do_now' | 'missing_item' | 'missing_target' | 'unsafe' | 'blocked' | 'not_relevant';

export interface WorkflowAvailability {
    workflowId: string;
    workflowVersion: number;
    evaluator: string;
    status: WorkflowAvailabilityStatus;
    reason: string;
    nextActionHint?: string;
    evidence: string[];
}

export interface GameSkillContextInput {
    resident: string;
    tick: number;
    activeGoal?: ActiveGoalState;
    perception: Perception;
}

export interface GameSkillContext {
    knowledgeResults: KnowledgeResult[];
    workflowAvailability: WorkflowAvailability[];
    brainSection: string;
    bodySection: string;
}

export interface GameSkillServiceOptions {
    entries?: KnowledgeEntry[];
    controllerId?: string;
    instanceId?: string;
    suggestionStore?: { append(suggestion: KnowledgeSuggestion): void; flush?(): Promise<void> };
}

export class GameSkillService {
    private readonly entries: KnowledgeEntry[];
    private readonly controllerId: string;
    private readonly instanceId: string;
    private readonly suggestionStore?: { append(suggestion: KnowledgeSuggestion): void; flush?(): Promise<void> };
    private readonly emittedSuggestionKeys = new Set<string>();

    constructor(options: GameSkillServiceOptions = {}) {
        this.entries = options.entries || ENGINE_KNOWLEDGE_ENTRIES;
        this.controllerId = options.controllerId || 'local-controller';
        this.instanceId = options.instanceId || 'local-instance';
        this.suggestionStore = options.suggestionStore;
    }

    buildContext(input: GameSkillContextInput): GameSkillContext {
        const facts = extractPerceptionFacts(input.perception);
        const perceptionText = [summarizePerception(input.perception), facts.text].filter(Boolean).join('\n');
        const goalText = [
            input.activeGoal?.id,
            input.activeGoal?.description,
            input.activeGoal?.steps?.join(' '),
            input.activeGoal?.success,
        ]
            .filter(Boolean)
            .join(' ');
        const workflowAvailability = evaluateWorkflows(goalText, perceptionText, facts);
        const availabilityText = workflowAvailability
            .filter(availability => availability.status !== 'not_relevant')
            .map(
                availability =>
                    `${availability.workflowId} ${availability.status} ${availability.reason} ${availability.nextActionHint || ''}`,
            )
            .join('\n');

        const perceptionContext = derivePerceptionContext(input.perception);
        const goalContext = deriveGoalContext(input.activeGoal);

        const knowledgeResults = retrieveKnowledge(this.entries, [goalText, perceptionText, availabilityText].join('\n'), {
            limit: 5,
            minScore: 4,
            perceptionContext,
            goalContext,
            tokenBudget: 1500,
        });
        const knowledge = formatKnowledgeForPrompt(knowledgeResults, { maxChars: 1600 });
        const availability = renderAvailability(workflowAvailability);

        return {
            knowledgeResults,
            workflowAvailability,
            brainSection: renderSection(availability, knowledge, 2600),
            bodySection: renderSection(availability, knowledge, 2200),
        };
    }

    observeAttempt(event: {
        resident: string;
        producer: 'nervous-system' | 'body';
        perception: Perception;
        context?: GameSkillContext;
        attempt: ActionAttempt;
    }): void {
        if (!this.suggestionStore) {
            return;
        }

        const workflow = selectWorkflowForAttempt(event.attempt, event.context?.workflowAvailability || []);
        if (event.attempt.finalStatus === 'success' && (!workflow || event.attempt.evidence.length === 0)) {
            return;
        }
        const suggestion = this.buildAttemptSuggestion(event, workflow);
        const dedupKey = knowledgeSuggestionDedupKey(suggestion);
        if (this.emittedSuggestionKeys.has(dedupKey)) {
            return;
        }

        this.emittedSuggestionKeys.add(dedupKey);
        this.suggestionStore.append({ ...suggestion, dedupKey });
    }

    async flush(): Promise<void> {
        await this.suggestionStore?.flush?.();
    }

    private buildAttemptSuggestion(
        event: {
            resident: string;
            producer: 'nervous-system' | 'body';
            perception: Perception;
            context?: GameSkillContext;
            attempt: ActionAttempt;
        },
        workflow: WorkflowAvailability | undefined,
    ): KnowledgeSuggestion {
        const actionKind =
            typeof event.attempt.action === 'object' && event.attempt.action !== null
                ? String((event.attempt.action as { kind?: unknown }).kind || 'action')
                : 'action';
        const reason = event.attempt.finalReason || event.attempt.finalStatus;
        const succeeded = event.attempt.finalStatus === 'success';
        return {
            id: `ks_${event.attempt.attemptId}`,
            dedupKey: '',
            createdAt: new Date().toISOString(),
            resident: event.resident,
            controllerId: this.controllerId,
            instanceId: this.instanceId,
            tick: typeof event.perception.tick === 'number' ? event.perception.tick : 0,
            status: 'proposed',
            source: event.producer === 'nervous-system' ? 'nervous_system' : 'body',
            trust: 'runtime_observed',
            workflowId: workflow?.workflowId,
            workflowVersion: workflow?.workflowVersion,
            observation: succeeded
                ? `${actionKind} succeeded with observed effect evidence.`
                : `${actionKind} ended with ${event.attempt.finalStatus}${reason ? ` (${reason})` : ''}.`,
            proposedChange: {
                kind: 'workflow_hint',
                targetId: workflow?.workflowId,
                summary: succeeded
                    ? `Review ${workflow?.workflowId || 'current workflow'}: ${actionKind} produced an observed effect that may confirm this workflow.`
                    : `Review ${workflow?.workflowId || 'current workflow'}: ${actionKind} did not produce the expected effect (${reason}).`,
                actions: [actionKind],
                successSignals: workflow ? [workflow.reason, ...effectEvidenceSummaries(event.attempt)] : undefined,
            },
            evidence: {
                outcome: succeeded
                    ? 'success'
                    : event.attempt.finalStatus === 'blocked' || event.attempt.finalStatus === 'timeout'
                      ? 'blocked'
                      : 'partial',
                attemptId: event.attempt.attemptId,
                action: event.attempt.action,
                actionStatus: event.attempt.finalStatus,
                actionReason: reason,
                perceptionId: `tick:${typeof event.perception.tick === 'number' ? event.perception.tick : 'unknown'}`,
                retrievedKnowledgeIds: (event.context?.knowledgeResults || []).map(result => result.entry.id),
                availability: (event.context?.workflowAvailability || []).map(availability => ({
                    workflowId: availability.workflowId,
                    status: availability.status,
                    reason: availability.reason,
                })),
                summaries: [
                    workflow?.reason || 'No workflow availability was attached to this attempt.',
                    ...effectEvidenceSummaries(event.attempt),
                ],
            },
            confidence: succeeded ? 0.7 : workflow ? 0.55 : 0.35,
        };
    }
}

function effectEvidenceSummaries(attempt: ActionAttempt): string[] {
    return attempt.evidence.slice(0, 3).map(evidence => {
        const detail = typeof evidence.detail === 'object' && evidence.detail !== null ? (evidence.detail as Record<string, unknown>) : {};
        const kind = typeof detail.kind === 'string' ? detail.kind : evidence.source;
        const changed = Array.isArray(detail.changed) ? ` changed=${detail.changed.join(',')}` : '';
        return `${kind}${changed}`;
    });
}

function selectWorkflowForAttempt(attempt: ActionAttempt, workflowAvailability: WorkflowAvailability[]): WorkflowAvailability | undefined {
    const visible = workflowAvailability.filter(availability => availability.status !== 'not_relevant');
    const preferredWorkflowId = preferredWorkflowForAttempt(attempt);
    if (preferredWorkflowId) {
        const preferred = visible.find(availability => availability.workflowId === preferredWorkflowId);
        if (preferred) {
            return preferred;
        }
    }
    return visible[0];
}

function preferredWorkflowForAttempt(attempt: ActionAttempt): string | undefined {
    const action = record(attempt.action);
    const kind = textField(action.kind);
    const option = textField(action.option);
    const text = textField(action.text);
    const cause = `${textField(action.cause)} ${textField(attempt.cause)}`.trim();
    const target = record(action.target);
    const combined = `${kind} ${option} ${text} ${cause} ${targetText(target)}`.toLowerCase();
    const words = combined.replace(/[_:-]+/g, ' ');

    if (kind === 'say' && /\bdirect chat (help|status|wait|stop|follow)\b|\bfollow listen hold\b|\bpresence beacon\b/.test(words)) {
        return 'follow-codex';
    }
    if (kind === 'item_action' && /\bbury\b/.test(option)) {
        return 'train-prayer';
    }
    if (
        kind === 'attack' ||
        /\battack\b|\bsafe combat\b|\bcombat attack\b|\bcombat seek\b|\bcombat approach\b|\bcombat loot\b|\bsafe target\b/.test(words)
    ) {
        return 'safe-combat';
    }
    if (isBonesTarget(target) || /\bbones?\b|\bbury\b/.test(words)) {
        return 'train-prayer';
    }
    if (/\bfishing\b|\bsmall net\b|\bstarter fishing\b/.test(words) || (kind === 'interact' && option === 'net')) {
        return 'fishing-starter';
    }
    if (/\bfiremaking\b|\bmake fire\b|\btinderbox\b|\bwoodcutting chain firemaking\b|\bfiremaking fallback\b/.test(words)) {
        return 'make-fire';
    }
    if (/\bwoodcutting\b|\bchop\b|\bchopping\b|\bchop down\b|\btree for logs\b/.test(words)) {
        return 'train-woodcutting';
    }
    if (
        /^trade_/.test(kind) ||
        /\btrade\b|\btrading\b|\btrade request\b|\btrade offer\b|\btrade accept\b|\btrade decline\b|\bdirect chat trade\b/.test(words)
    ) {
        return 'trade-request';
    }
    if (/\bfollow\b|\bfollow codex\b|\bcodex\b/.test(words)) {
        return 'follow-codex';
    }
    return undefined;
}

function targetText(target: Record<string, unknown>): string {
    return [target.key, target.name, target.itemId, target.id, target.objectId].map(value => String(value || '')).join(' ');
}

function isBonesTarget(target: Record<string, unknown>): boolean {
    const itemId = typeof target.itemId === 'number' ? target.itemId : undefined;
    if (itemId !== undefined && [526, 528, 530, 532, 534, 536].includes(itemId)) {
        return true;
    }
    return /\bbones?\b/.test(targetText(target).toLowerCase().replace(/[_:]/g, ' '));
}

function textField(value: unknown): string {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

function evaluateWorkflows(goalText: string, perceptionText: string, facts: PerceptionFacts): WorkflowAvailability[] {
    const relevanceText = `${goalText}\n${perceptionText}`.toLowerCase();
    const evidenceText = perceptionText.toLowerCase();
    return [
        evaluateFiremaking(relevanceText, evidenceText, facts),
        evaluateWoodcutting(relevanceText, evidenceText, facts),
        evaluateFishing(relevanceText, evidenceText, facts),
        evaluatePrayer(relevanceText, evidenceText, facts),
        evaluateSafeCombat(relevanceText, evidenceText, facts),
        evaluateTrading(relevanceText, evidenceText, facts),
        evaluateFollow(relevanceText, evidenceText, facts),
    ].filter((availability): availability is WorkflowAvailability => Boolean(availability));
}

function evaluateFiremaking(relevanceText: string, evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/fire|burn|logs|tinderbox|light/.test(relevanceText)) {
        return undefined;
    }

    const hasTinderbox = facts.tinderboxSlot !== undefined || /rs:tinderbox|\btinderbox\b|itemid["': ]+590/.test(evidenceText);
    const hasLogs = facts.logsSlot !== undefined || /rs:logs|\bnormal logs\b|\blogs\b|itemid["': ]+1511/.test(evidenceText);
    const hasTree = facts.treeVisible || /\btree\b|dead tree|chop down/.test(evidenceText);

    if (hasTinderbox && hasLogs) {
        const hint =
            facts.tinderboxSlot !== undefined && facts.logsSlot !== undefined
                ? `use_item_on_item itemSlot=${facts.tinderboxSlot} targetSlot=${facts.logsSlot}`
                : 'use_item_on_item with tinderbox slot and logs slot';
        return availability('make-fire', 'can_do_now', 'Tinderbox and logs are visible in inventory.', hint, [
            'inventory has tinderbox',
            'inventory has logs',
        ]);
    }
    if (hasTinderbox && hasTree) {
        return availability(
            'make-fire',
            'missing_item',
            'Tinderbox is present, but logs must be gathered first.',
            'chop a visible Tree or Dead tree for logs',
            ['inventory has tinderbox', 'visible tree target'],
        );
    }
    if (!hasTinderbox) {
        return availability(
            'make-fire',
            'missing_item',
            'A tinderbox is required before logs can be lit.',
            'find or ask for a tinderbox',
            [],
        );
    }

    return availability(
        'make-fire',
        'missing_target',
        'Logs are required before firemaking can happen.',
        'find logs or chop a visible ordinary tree',
        [],
    );
}

function evaluateWoodcutting(relevanceText: string, evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/woodcut|chop|tree|logs/.test(relevanceText)) {
        return undefined;
    }

    const hasTree = facts.treeVisible || /\btree\b|dead tree|chop down/.test(evidenceText);
    const hasAxe = facts.hasStructuredInventory ? facts.hasWoodcuttingAxe : /\baxe\b|\bhatchet\b/.test(evidenceText);
    if (!hasAxe) {
        return availability(
            'train-woodcutting',
            'missing_item',
            'Woodcutting needs an axe or hatchet in inventory or equipment.',
            'find, buy, or equip an axe before chopping trees',
            [],
        );
    }
    if (hasTree) {
        return availability(
            'train-woodcutting',
            'can_do_now',
            'A tree target appears visible.',
            'move beside the tree and interact with "chop down"',
            ['visible tree target'],
        );
    }

    return availability(
        'train-woodcutting',
        'missing_target',
        'No tree target is visible.',
        'explore locally until a Tree or Dead tree is visible',
        [],
    );
}

function evaluateFishing(relevanceText: string, evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/fish|shrimp|anchovies|small net|small_fishing_net|fishing spot/.test(relevanceText)) {
        return undefined;
    }

    const hasSmallNet = facts.hasSmallFishingNet || /rs:small_fishing_net|small fishing net|small net/.test(evidenceText);
    const hasSpot = facts.fishingSpotVisible || /fishing spot|\bnet option\b|\bnet\b/.test(evidenceText);
    if (hasSmallNet && hasSpot) {
        return availability(
            'fishing-starter',
            'can_do_now',
            'Small fishing net and a net-capable fishing spot are visible.',
            'interact with the fishing spot using the net option',
            ['inventory has small net', 'visible fishing spot'],
        );
    }
    if (!hasSmallNet) {
        return availability(
            'fishing-starter',
            'missing_item',
            'Starter fishing needs a small fishing net.',
            'find or buy a small fishing net',
            [],
        );
    }

    return availability(
        'fishing-starter',
        'missing_target',
        'A fishing spot is needed.',
        'explore water areas until a fishing spot is visible',
        ['inventory has small net'],
    );
}

function evaluatePrayer(relevanceText: string, _evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/prayer|bone|bones|bury/.test(relevanceText)) {
        return undefined;
    }
    if (facts.bonesSlot !== undefined) {
        return availability(
            'train-prayer',
            'can_do_now',
            'Bones are visible in inventory.',
            `item_action slot=${facts.bonesSlot} option=bury`,
            ['inventory has bones'],
        );
    }

    return availability(
        'train-prayer',
        'missing_item',
        'Bones are needed before Prayer can be trained.',
        'pick up visible bones or fight a safe bone source',
        [],
    );
}

function evaluateSafeCombat(relevanceText: string, evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/combat|fight|attack|chicken|cow|goblin|rat|bones|bury/.test(relevanceText)) {
        return undefined;
    }

    const lowHealth = facts.hpFraction !== undefined ? facts.hpFraction <= 0.3 : isLowHealth(evidenceText);
    const foodAvailable = facts.hasStructuredInventory ? facts.hasFood : hasFood(evidenceText);
    if (lowHealth && !foodAvailable) {
        return availability('safe-combat', 'unsafe', 'Health is low and no food is visible.', 'do not attack; retreat or find food first', [
            'low hp',
            'no food',
        ]);
    }
    if (facts.safeCombatTargetVisible || /chicken|cow|goblin|giant rat|\brat\b/.test(evidenceText)) {
        return availability(
            'safe-combat',
            'can_do_now',
            'A low-risk target appears visible and no safety veto fired.',
            'attack the safe target, then loot bones if they appear',
            ['visible low-risk target'],
        );
    }

    return availability(
        'safe-combat',
        'missing_target',
        'No low-risk combat target is visible.',
        'look for chicken, cow, rat, giant rat, or goblin',
        [],
    );
}

function evaluateTrading(relevanceText: string, evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/\btrade\b|\btrading\b|\boffer\b|trade_request|trade_offer|trade_accept|trade_decline/.test(relevanceText)) {
        return undefined;
    }

    if (facts.hpFraction !== undefined && facts.hpFraction <= 0.2) {
        return availability('trade-request', 'unsafe', 'Health is too low to safely handle a trade.', 'heal or retreat before trading', [
            `hp fraction ${facts.hpFraction.toFixed(2)}`,
        ]);
    }

    if (facts.activeTradeVisible || /active trade|trade_opened|trade_offer_updated|trade_accept/.test(evidenceText)) {
        return availability(
            'trade-request',
            'can_do_now',
            'A trade window is open or updating.',
            'offer a safe item, accept fair terms, or decline unsafe terms',
            ['active trade state visible'],
        );
    }

    if (facts.tradeTargetVisible || /trade_request/.test(evidenceText)) {
        return availability(
            'trade-request',
            'can_do_now',
            'A tradable player or resident is visible.',
            'trade_request the visible target, then offer, accept, or decline safely',
            ['visible trade target'],
        );
    }

    return availability(
        'trade-request',
        'missing_target',
        'Trading needs a visible player or resident target.',
        'move near the player first',
        ['trade intent observed'],
    );
}

function evaluateFollow(relevanceText: string, evidenceText: string, facts: PerceptionFacts): WorkflowAvailability | undefined {
    if (!/codex|follow|find|visible|where|meet/.test(relevanceText)) {
        return undefined;
    }
    const hasNoPlayerEvidence = /\bno players? visible\b|\bno visible players?\b/.test(evidenceText);
    const hasNoAnchorEvidence = /\bno anchor\b|\bno visibility anchor\b/.test(evidenceText);
    const hasNoChatEvidence = /\bno chat\b/.test(evidenceText);
    const hasPlayerOrAnchor =
        facts.codexVisible ||
        (!hasNoPlayerEvidence && !hasNoAnchorEvidence && /codex|player:|nearby player|visibility anchor|anchor/.test(evidenceText));
    const hasChatLead = !hasNoChatEvidence && /\bchat\b.*\bcodex\b|\bcodex\b.*\bchat\b/.test(evidenceText);
    if (!hasPlayerOrAnchor && !hasChatLead) {
        return availability(
            'follow-codex',
            'missing_target',
            'Codex or a visibility anchor is not visible in current perception.',
            'say current location if asked, otherwise keep exploring locally',
            [],
        );
    }

    return availability(
        'follow-codex',
        'can_do_now',
        'Current perception includes Codex or a visibility anchor.',
        'say current goal and move toward the visible player or anchor',
        ['visible player/anchor clue'],
    );
}

function availability(
    workflowId: string,
    status: WorkflowAvailabilityStatus,
    reason: string,
    nextActionHint: string,
    evidence: string[],
): WorkflowAvailability {
    return {
        workflowId,
        workflowVersion: 1,
        evaluator: `${workflowId}-v1`,
        status,
        reason,
        nextActionHint,
        evidence,
    };
}

function renderAvailability(workflowAvailability: WorkflowAvailability[]): string {
    const visible = workflowAvailability.filter(availability => availability.status !== 'not_relevant').sort(compareAvailabilityPriority);
    if (!visible.length) {
        return '';
    }

    return [
        'Workflow availability:',
        ...visible.map(
            availability =>
                `- ${availability.workflowId} [${availability.status}]: ${availability.reason} Next: ${availability.nextActionHint || 'observe before acting'}. Evidence: ${availability.evidence.join(', ') || 'goal/perception text'}.`,
        ),
    ].join('\n');
}

function compareAvailabilityPriority(a: WorkflowAvailability, b: WorkflowAvailability): number {
    return statusPriority(a.status) - statusPriority(b.status);
}

function statusPriority(status: WorkflowAvailabilityStatus): number {
    switch (status) {
        case 'unsafe':
            return 0;
        case 'can_do_now':
            return 1;
        case 'missing_item':
            return 2;
        case 'missing_target':
            return 3;
        case 'blocked':
            return 4;
        case 'not_relevant':
            return 5;
    }
}

function renderSection(availability: string, knowledge: string, maxChars: number): string {
    const sections = [availability, knowledge ? `Relevant game knowledge:\n${knowledge}` : ''].filter(Boolean);
    const rendered: string[] = [];
    for (const section of sections) {
        const next = [...rendered, section].join('\n\n');
        if (next.length > maxChars) {
            break;
        }
        rendered.push(section);
    }

    return rendered.join('\n\n');
}

function summarizePerception(perception: Perception): string {
    return typeof perception.compressed === 'string' ? perception.compressed : JSON.stringify(perception);
}

interface PerceptionFacts {
    text: string;
    hasStructuredInventory: boolean;
    tinderboxSlot?: number;
    logsSlot?: number;
    hasWoodcuttingAxe: boolean;
    hasSmallFishingNet: boolean;
    hasFood: boolean;
    bonesSlot?: number;
    hpFraction?: number;
    treeVisible: boolean;
    fishingSpotVisible: boolean;
    safeCombatTargetVisible: boolean;
    tradeTargetVisible: boolean;
    activeTradeVisible: boolean;
    codexVisible: boolean;
}

interface InventoryFact {
    slot: number;
    itemId?: number;
    key?: string;
    name?: string;
}

function extractPerceptionFacts(perception: Perception): PerceptionFacts {
    const root = record(perception);
    const resident = record(root.resident);
    const inventory = inventoryFacts(resident.inventory);
    const equipment = inventoryFacts(resident.equipment);
    const nearby = record(root.nearby);
    const availableActions = Array.isArray(root.availableActions) ? root.availableActions : [];
    const nearbyPlayers = Array.isArray(nearby.players) ? nearby.players : [];
    const nearbyText = JSON.stringify(nearby).toLowerCase();
    const actionText = JSON.stringify(availableActions).toLowerCase();
    const hp = record(resident.hp);
    const currentHp = typeof hp.current === 'number' ? hp.current : undefined;
    const maxHp = typeof hp.max === 'number' && hp.max > 0 ? hp.max : undefined;
    const hpFraction = currentHp !== undefined && maxHp !== undefined ? currentHp / maxHp : undefined;
    const allItems = [...inventory, ...equipment];

    const facts = {
        text: '',
        hasStructuredInventory: Array.isArray(resident.inventory),
        tinderboxSlot: inventory.find(item => itemMatches(item, /\btinderbox\b/, [590]))?.slot,
        logsSlot: inventory.find(item => itemMatches(item, /\blogs\b/, [1511]))?.slot,
        hasWoodcuttingAxe: allItems.some(item => itemMatches(item, /\b(axe|hatchet)\b/, [1351, 1349, 1353, 1361, 1355, 1357, 1359])),
        hasSmallFishingNet: inventory.some(item => itemMatches(item, /\bsmall(_|\s)?fishing(_|\s)?net\b|\bsmall net\b/, [303])),
        hasFood: inventory.some(item =>
            itemMatches(
                item,
                /\b(shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bread|cake|meat)\b/,
                [315, 319, 325, 329, 333, 335, 361, 379, 2309, 1891],
            ),
        ),
        bonesSlot: inventory.find(item => itemMatches(item, /\bbones?\b/, [526, 528, 530, 532, 534, 536]))?.slot,
        hpFraction,
        treeVisible: /chop down|chop/.test(actionText) || /\b(tree|dead tree)\b/.test(nearbyText),
        fishingSpotVisible: /fishing spot/.test(nearbyText) || (/interact/.test(actionText) && /\bnet\b/.test(actionText)),
        safeCombatTargetVisible: /\b(chicken|cow|goblin|giant rat|rat)\b/.test(nearbyText),
        tradeTargetVisible: nearbyPlayers.length > 0 || /trade_request/.test(actionText),
        activeTradeVisible: Object.keys(record(resident.activeTrade)).length > 0,
        codexVisible: /\bcodex\b/.test(nearbyText),
    };

    facts.text = [
        inventory.map(item => `inventory slot ${item.slot} ${item.key || item.name || item.itemId || 'item'}`).join('; '),
        currentHp !== undefined && maxHp !== undefined ? `hp ${currentHp}/${maxHp}` : '',
        facts.treeVisible ? 'visible tree action' : '',
        facts.fishingSpotVisible ? 'visible fishing spot action' : '',
        facts.safeCombatTargetVisible ? 'visible safe combat target' : '',
        facts.tradeTargetVisible ? 'visible trade target' : '',
        facts.activeTradeVisible ? 'active trade window' : '',
        facts.codexVisible ? 'visible codex player' : '',
    ]
        .filter(Boolean)
        .join('\n');

    return facts;
}

function inventoryFacts(value: unknown): InventoryFact[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item, slot): InventoryFact | undefined => {
            const itemRecord = record(item);
            if (!Object.keys(itemRecord).length) {
                return undefined;
            }
            return {
                slot,
                itemId: typeof itemRecord.itemId === 'number' ? itemRecord.itemId : undefined,
                key: typeof itemRecord.key === 'string' ? itemRecord.key : undefined,
                name: typeof itemRecord.name === 'string' ? itemRecord.name : undefined,
            };
        })
        .filter((item): item is InventoryFact => Boolean(item));
}

function itemMatches(item: InventoryFact, keyPattern: RegExp, itemIds: number[]): boolean {
    const text = `${item.key || ''} ${item.name || ''}`.toLowerCase().replace(/[_:]/g, ' ');
    return (item.itemId !== undefined && itemIds.includes(item.itemId)) || keyPattern.test(text);
}

function isLowHealth(text: string): boolean {
    const match = text.match(/\bhp\s+(\d+)\s*\/\s*(\d+)/i);
    if (!match) {
        return false;
    }

    const current = Number(match[1]);
    const max = Number(match[2]);
    return max > 0 && current / max <= 0.3;
}

function hasFood(text: string): boolean {
    return (
        !/\bno food\b/.test(text) &&
        /\b(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bread|cake|meat|chicken)\b/.test(text)
    );
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
