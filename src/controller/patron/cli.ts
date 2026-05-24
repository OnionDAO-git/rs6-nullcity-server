import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import { PatronStore } from './patron-store';
import { PatronGateway } from './patron-gateway';
import { LettersStore } from './letters-store';
import { SoulLoader } from '../soul/soul-loader';
import { RuntimeStateStore, addAttention } from '../memory/runtime-state';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from '../evidence';

export interface PatronCliOptions {
    action: 'grant' | 'offer' | '';
    humanId: string;
    amount: number;
    residentName: string;
    configPath: string;
}

export function parsePatronCliArgs(argv: string[]): PatronCliOptions {
    const options: PatronCliOptions = {
        action: '',
        humanId: '',
        amount: 0,
        residentName: '',
        configPath: 'controller.yml',
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--grant') {
            options.action = 'grant';
        } else if (arg === '--offer') {
            options.action = 'offer';
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
        throw new Error('Either --grant or --offer must be specified.');
    }
    if (!options.humanId) {
        throw new Error('--human <id> is required.');
    }
    if (options.amount <= 0 || !Number.isInteger(options.amount)) {
        throw new Error('--amount must be a positive integer.');
    }
    if (options.action === 'offer' && !options.residentName) {
        throw new Error('--resident <name> is required for --offer.');
    }

    return options;
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
            const currencyLedger = store.loadCurrency();
            const standingLedger = store.loadStanding();

            let residentName = options.residentName;
            if (!residentName.startsWith('res:')) {
                residentName = `res:${residentName}`;
            }

            const loader = new SoulLoader(config.souls.dir);
            let soul;
            try {
                soul = loader.load(residentName);
            } catch (err) {
                throw new Error(`Failed to load resident soul for "${residentName}": ${err instanceof Error ? err.message : String(err)}`);
            }

            const stateStore = new RuntimeStateStore(config.memory.dir);
            const initialAttention = soul.frontmatter.attentionProfile?.startingAttention ?? 100;
            const legacyKind = soul.frontmatter.archetype ?? 'default';
            const state = stateStore.load(residentName, initialAttention, legacyKind);

            const evidenceStore = new EvidenceStore(residentName, config.memory.dir);
            const sessionId = `cli-patron-${Date.now()}`;
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
                        `[patron:offer] Attention for "${residentName}" increased by ${amount}. New attention: ${state.attention}.`,
                    );
                },
            };

            const runtimes = new Map<string, any>();
            runtimes.set(residentName, mockRuntime);

            // E6 fix: pass a LettersStore so tier-crossing letters reach
            // disk same as ControllerHost's gateway does via EVENT-D1a.
            // Without this the CLI happily reports "Standing Tier crossed!"
            // and the patron's inbox stays empty.
            const gateway = new PatronGateway({
                currencyLedger,
                standingLedger,
                runtimes: runtimes as any,
                soulsDir: config.souls.dir,
                lettersStore: new LettersStore(config.memory.dir),
            });

            const outcome = await gateway.offerTo({
                humanId: options.humanId,
                residentName,
                amount: options.amount,
                interactionContext: 'cli_offer',
            });

            if (outcome.ok) {
                store.saveCurrency(currencyLedger);
                store.saveStanding(standingLedger);
                console.log(
                    `[patron:offer] Successfully offered ${options.amount} Shards from human "${options.humanId}" to resident "${residentName}".`,
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
            } else {
                throw new Error(`Offer failed: ${outcome.error}`);
            }
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
