import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import { PatronStore } from './patron-store';
import { PatronGateway } from './patron-gateway';
import { LettersStore } from './letters-store';
import { SoulLoader } from '../soul/soul-loader';
import { RuntimeStateStore, addAttention, residentSlug } from '../memory/runtime-state';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from '../evidence';

export type PatronCliAction = 'grant' | 'offer' | 'ask' | 'witness' | '';

export interface PatronCliOptions {
    action: PatronCliAction;
    humanId: string;
    amount: number;
    residentName: string;
    text: string;
    artifact: string;
    configPath: string;
}

export function parsePatronCliArgs(argv: string[]): PatronCliOptions {
    const options: PatronCliOptions = {
        action: '',
        humanId: '',
        amount: 0,
        residentName: '',
        text: '',
        artifact: '',
        configPath: 'controller.yml',
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--grant') {
            options.action = 'grant';
        } else if (arg === '--offer') {
            options.action = 'offer';
        } else if (arg === '--ask') {
            options.action = 'ask';
        } else if (arg === '--witness') {
            options.action = 'witness';
        } else if (arg === '--human') {
            const next = argv[i + 1];
            if (!next) throw new Error('--human requires a value');
            options.humanId = next;
            i += 1;
        } else if (arg.startsWith('--human=')) {
            options.humanId = arg.slice('--human='.length);
        } else if (arg === '--amount') {
            const next = argv[i + 1];
            if (!next) throw new Error('--amount requires a value');
            options.amount = Number(next);
            i += 1;
        } else if (arg.startsWith('--amount=')) {
            options.amount = Number(arg.slice('--amount='.length));
        } else if (arg === '--resident') {
            const next = argv[i + 1];
            if (!next) throw new Error('--resident requires a value');
            options.residentName = next;
            i += 1;
        } else if (arg.startsWith('--resident=')) {
            options.residentName = arg.slice('--resident='.length);
        } else if (arg === '--text') {
            const next = argv[i + 1];
            if (!next) throw new Error('--text requires a value');
            options.text = next;
            i += 1;
        } else if (arg.startsWith('--text=')) {
            options.text = arg.slice('--text='.length);
        } else if (arg === '--artifact') {
            const next = argv[i + 1];
            if (!next) throw new Error('--artifact requires a value');
            options.artifact = next;
            i += 1;
        } else if (arg.startsWith('--artifact=')) {
            options.artifact = arg.slice('--artifact='.length);
        } else if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error('--config requires a path');
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        }
    }

    if (!options.action) {
        throw new Error('One of --grant, --offer, --ask, or --witness must be specified.');
    }
    if (!options.humanId) {
        throw new Error('--human <id> is required.');
    }

    // Per-action validation. `--ask` and `--witness` do not require --amount
    // (they have no Shards transfer); they do require --resident and --text /
    // --artifact respectively.
    if (options.action === 'grant' || options.action === 'offer') {
        if (options.amount <= 0 || !Number.isInteger(options.amount)) {
            throw new Error('--amount must be a positive integer.');
        }
    }
    if (options.action === 'offer' && !options.residentName) {
        throw new Error('--resident <name> is required for --offer.');
    }
    if (options.action === 'ask') {
        if (!options.residentName) {
            throw new Error('--resident <name> is required for --ask.');
        }
        if (!options.text || options.text.trim().length === 0) {
            throw new Error('--text <question> is required for --ask.');
        }
    }
    if (options.action === 'witness') {
        if (!options.residentName) {
            throw new Error('--resident <name> is required for --witness.');
        }
        if (!options.artifact) {
            throw new Error('--artifact <id> is required for --witness.');
        }
    }

    return options;
}

interface ResidentRuntimeBundle {
    residentName: string;
    runtimes: Map<string, any>;
    gateway: PatronGateway;
    currencyLedger: ReturnType<PatronStore['loadCurrency']>;
    standingLedger: ReturnType<PatronStore['loadStanding']>;
    persistLedgers: () => void;
}

/**
 * Build the patron-CLI "mock runtime" sandbox used by every verb that targets
 * a specific resident (offer / ask / witness). This is a thin wrapper around
 * the SoulLoader + RuntimeStateStore + EvidenceStore stack that the
 * ControllerHost normally wires together — extracted so the four verbs share
 * the same wiring instead of each rebuilding it ad-hoc.
 */
function buildResidentBundle(
    options: PatronCliOptions,
    config: ReturnType<typeof loadControllerConfig>,
    store: PatronStore,
    verbTag: string,
): ResidentRuntimeBundle {
    let residentName = options.residentName;
    if (!residentName.startsWith('res:')) {
        residentName = `res:${residentName}`;
    }

    const loader = new SoulLoader(config.souls.dir);
    let soul;
    try {
        soul = loader.load(residentName);
    } catch (err) {
        throw new Error(
            `Failed to load resident soul for "${residentName}": ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const currencyLedger = store.loadCurrency();
    const standingLedger = store.loadStanding();

    const stateStore = new RuntimeStateStore(config.memory.dir);
    const initialAttention = soul.frontmatter.attentionProfile?.startingAttention ?? 100;
    const legacyKind = soul.frontmatter.archetype ?? 'default';
    const state = stateStore.load(residentName, initialAttention, legacyKind);

    const evidenceStore = new EvidenceStore(residentName, config.memory.dir);
    const sessionId = `cli-patron-${verbTag}-${Date.now()}`;
    evidenceStore.beginSession(sessionId, soul.sourcePath || 'unknown-soul');

    const evidence = {
        store: evidenceStore,
        sessionId,
        trajectory: new TrajectoryBuilder(evidenceStore),
        library: new LibraryUpdater(residentName, config.memory.dir),
    };

    const mockRuntime = {
        name: residentName,
        getState: () => ({
            tick: state.tick,
            faction: soul.frontmatter.faction || 'embassy',
        }),
        getEvidence: () => evidence,
        incrementAttention: (amount: number) => {
            addAttention(state, amount);
            stateStore.save(state);
            console.log(
                `[patron:${verbTag}] Attention for "${residentName}" increased by ${amount}. New attention: ${state.attention}.`,
            );
        },
    };

    const runtimes = new Map<string, any>();
    runtimes.set(residentName, mockRuntime);

    const gateway = new PatronGateway({
        currencyLedger,
        standingLedger,
        runtimes: runtimes as any,
        soulsDir: config.souls.dir,
        // E6 fix: pass a LettersStore so tier-crossing letters reach disk the
        // same way ControllerHost's gateway does via EVENT-D1a. Without this
        // tier-crossing verbs report "Standing Tier crossed!" and the
        // patron's inbox stays empty.
        lettersStore: new LettersStore(config.memory.dir),
        // ask verb needs memoryDir so it can append patron_ask events
        // directly to library/<slug>/timeline.jsonl.
        memoryDir: config.memory.dir,
    });

    return {
        residentName,
        runtimes,
        gateway,
        currencyLedger,
        standingLedger,
        persistLedgers: () => {
            store.saveCurrency(currencyLedger);
            store.saveStanding(standingLedger);
        },
    };
}

/**
 * Scan the resident's most recent trajectory file for a `say` event that
 * landed AFTER `sinceTs`. Used by the ask verb to surface "did the resident
 * reply?" to the patron at the terminal. Returns null when nothing matches.
 *
 * NOTE: this is best-effort. The ask verb does NOT synthesize a chat
 * perception event onto the runtime queue (that would require touching
 * resident-runtime.ts, Codex zone). The Brain only sees the question on its
 * NEXT wake, via the library-timeline memory rendering — so the most common
 * outcome at CLI time is `null` (no fresh say yet). This is documented as
 * the chat-synthesis coordination gap.
 */
function findRecentSay(memoryDir: string, residentName: string, sinceTs: string): string | null {
    const slug = residentSlug(residentName);
    const trajectoryRoot = path.join(memoryDir, slug, 'sessions');
    if (!fs.existsSync(trajectoryRoot)) {
        return null;
    }
    const sessionDirs = fs.readdirSync(trajectoryRoot).filter(name => {
        try {
            return fs.statSync(path.join(trajectoryRoot, name)).isDirectory();
        } catch {
            return false;
        }
    });
    let latestSay: { text: string; ts: string } | null = null;
    for (const sessionDir of sessionDirs) {
        const trajectoryPath = path.join(trajectoryRoot, sessionDir, 'trajectory.jsonl');
        if (!fs.existsSync(trajectoryPath)) {
            continue;
        }
        const lines = fs.readFileSync(trajectoryPath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as { kind?: string; text?: string; ts?: string };
                if (entry.kind === 'say' && typeof entry.text === 'string' && typeof entry.ts === 'string' && entry.ts > sinceTs) {
                    if (!latestSay || entry.ts > latestSay.ts) {
                        latestSay = { text: entry.text, ts: entry.ts };
                    }
                }
            } catch {
                // skip malformed lines
            }
        }
    }
    return latestSay?.text ?? null;
}

export async function runPatronCli(argv: string[]): Promise<number> {
    try {
        const options = parsePatronCliArgs(argv);
        const config = loadControllerConfig(options.configPath);
        const store = new PatronStore(config.memory.dir);

        if (options.action === 'grant') {
            const ledger = store.loadCurrency();
            ledger.credit(options.humanId, options.amount, {
                reason: 'cli_grant',
                ts: new Date().toISOString(),
            });
            store.saveCurrency(ledger);
            console.log(`[patron:grant] Successfully credited ${options.amount} Shards to human "${options.humanId}".`);
            console.log(`[patron:grant] New balance: ${ledger.balance(options.humanId)} Shards.`);
            return 0;
        }

        if (options.action === 'offer') {
            const bundle = buildResidentBundle(options, config, store, 'offer');

            const outcome = await bundle.gateway.offerTo({
                humanId: options.humanId,
                residentName: bundle.residentName,
                amount: options.amount,
                interactionContext: 'cli_offer',
            });

            if (outcome.ok) {
                bundle.persistLedgers();
                console.log(
                    `[patron:offer] Successfully offered ${options.amount} Shards from human "${options.humanId}" to resident "${bundle.residentName}".`,
                );
                console.log(`[patron:offer] Event ID: ${outcome.eventId}`);
                if (outcome.standingDelta) {
                    const delta = outcome.standingDelta;
                    console.log(`[patron:offer] Standing with faction "${delta.factionId}": ${delta.before} -> ${delta.after}`);
                    if (delta.tierCrossed) {
                        console.log(`[patron:offer] Standing Tier crossed! Now: "${delta.tierCrossed}"`);
                    }
                }
                return 0;
            }
            throw new Error(`Offer failed: ${outcome.error}`);
        }

        if (options.action === 'ask') {
            const bundle = buildResidentBundle(options, config, store, 'ask');
            const startedAt = new Date().toISOString();

            const outcome = await bundle.gateway.askResident(options.humanId, bundle.residentName, options.text);

            if (outcome.ok) {
                bundle.persistLedgers();
                console.log(
                    `[patron:ask] Successfully asked resident "${bundle.residentName}" on behalf of human "${options.humanId}":`,
                );
                console.log(`[patron:ask]   "${options.text}"`);
                console.log(`[patron:ask] Event ID: ${outcome.eventId}`);

                // Best-effort: poll trajectory briefly for a fresh `say`.
                // Substrate-only: this won't typically capture a reply because
                // the chat perception event is NOT yet synthesized onto the
                // runtime queue (Codex-zone coordination gap). We still poll
                // so that, once the synthesis lands, this code path "just
                // works" without changes to the CLI.
                const pollTimeoutMs = 5000;
                const pollIntervalMs = 250;
                const deadline = Date.now() + pollTimeoutMs;
                let reply: string | null = null;
                while (Date.now() < deadline) {
                    reply = findRecentSay(config.memory.dir, bundle.residentName, startedAt);
                    if (reply) break;
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                }

                if (reply) {
                    console.log(`[patron:ask] Resident replied: "${reply}"`);
                } else {
                    console.log(
                        `[patron:ask] No response captured within ${pollTimeoutMs}ms. The question was recorded; the Brain will see it on next wake.`,
                    );
                }
                return 0;
            }
            throw new Error(`Ask failed: ${outcome.error}`);
        }

        if (options.action === 'witness') {
            const bundle = buildResidentBundle(options, config, store, 'witness');

            const witnessAmount = options.amount > 0 ? options.amount : 3;
            const outcome = await bundle.gateway.witnessAt(
                options.humanId,
                options.artifact,
                bundle.residentName,
                witnessAmount,
            );

            if (outcome.ok) {
                bundle.persistLedgers();
                console.log(
                    `[patron:witness] Human "${options.humanId}" witnessed artifact "${options.artifact}" by resident "${bundle.residentName}".`,
                );
                console.log(`[patron:witness] Event ID: ${outcome.eventId}`);
                if (outcome.standingDelta) {
                    const delta = outcome.standingDelta;
                    console.log(
                        `[patron:witness] Standing with faction "${delta.factionId}": ${delta.before} -> ${delta.after} (+${witnessAmount})`,
                    );
                    if (delta.tierCrossed) {
                        console.log(`[patron:witness] Standing Tier crossed! Now: "${delta.tierCrossed}"`);
                    }
                }
                return 0;
            }
            throw new Error(`Witness failed: ${outcome.error}`);
        }

        return 0;
    } catch (error) {
        console.error(`[patron:cli] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (require.main === module) {
    runPatronCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
