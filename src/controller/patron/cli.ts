import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadControllerConfig } from '../config';
import { PatronStore } from './patron-store';
import { PatronGateway, type PatronEventOutcome } from './patron-gateway';
import { LettersStore } from './letters-store';
import { SoulLoader } from '../soul/soul-loader';
import { RuntimeStateStore, addAttention, residentSlug } from '../memory/runtime-state';
import { LibraryUpdater } from '../evidence';
import { STANDING_TIERS } from './standing-ledger';
import { LoreBus } from '../lore/lore-bus';
import { publishWhisper } from '../lore/whisper';

export type PatronCliAction =
    | 'grant'
    | 'offer'
    | 'ask'
    | 'witness'
    | 'register'
    | 'checkin'
    | 'referral'
    | 'balance'
    | 'standing'
    | 'whisper'
    | '';

/**
 * Kind of patron registration: governs what nervous-system rules will treat
 * this handle as eligible for. `patron_gift` is the default (general patron
 * able to grant + offer); `patron_witness` is restricted to witness verbs;
 * `patron_sponsor` is for birth-ritual ceremonies. Per
 * `src/controller/config.ts:readPatronArray` enum.
 */
export type PatronRegisterKind = 'patron_gift' | 'patron_witness' | 'patron_sponsor';

export interface PatronCliOptions {
    action: PatronCliAction;
    humanId: string;
    amount: number;
    residentName: string;
    text: string;
    artifact: string;
    /** For --register: which patron kind to record. Defaults to 'patron_gift'. */
    kind: PatronRegisterKind;
    /** For --referral: the new human being referred (--human is the referrer). */
    referredId: string;
    /** For --standing: which faction ledger to query. Defaults to 'embassy'. */
    faction: string;
    configPath: string;
}

export interface RunningControllerAskInput {
    url: string;
    token: string;
    humanId: string;
    residentName: string;
    text: string;
}

export interface RunningControllerAskResult {
    ok: boolean;
    eventId: string;
    enqueued: boolean;
    error?: string;
}

export interface RunningControllerOfferInput {
    url: string;
    token: string;
    humanId: string;
    residentName: string;
    amount: number;
}

export type RunningControllerOfferResult = PatronEventOutcome;

export interface RunningControllerWhisperInput {
    url: string;
    token: string;
    humanId: string;
    residentName: string;
    text: string;
}

export interface RunningControllerWhisperResult {
    ok: boolean;
    error?: string;
}

export interface PatronCliRuntimeDeps {
    env?: Record<string, string | undefined>;
    askRunningController?: (input: RunningControllerAskInput) => Promise<RunningControllerAskResult>;
    offerRunningController?: (input: RunningControllerOfferInput) => Promise<RunningControllerOfferResult>;
    whisperRunningController?: (input: RunningControllerWhisperInput) => Promise<RunningControllerWhisperResult>;
}

export interface FindRecentSayOptions {
    cause?: string;
    textIncludes?: string;
}

export function parsePatronCliArgs(argv: string[]): PatronCliOptions {
    const options: PatronCliOptions = {
        action: '',
        humanId: '',
        amount: 0,
        residentName: '',
        text: '',
        artifact: '',
        kind: 'patron_gift',
        referredId: '',
        faction: 'embassy',
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
        } else if (arg === '--register') {
            options.action = 'register';
        } else if (arg === '--checkin') {
            options.action = 'checkin';
        } else if (arg === '--referral') {
            options.action = 'referral';
        } else if (arg === '--balance') {
            options.action = 'balance';
        } else if (arg === '--standing') {
            options.action = 'standing';
        } else if (arg === '--whisper') {
            options.action = 'whisper';
        } else if (arg === '--faction') {
            const next = argv[i + 1];
            if (!next) throw new Error('--faction requires a value');
            options.faction = next;
            i += 1;
        } else if (arg.startsWith('--faction=')) {
            options.faction = arg.slice('--faction='.length);
        } else if (arg === '--referred') {
            const next = argv[i + 1];
            if (!next) throw new Error('--referred requires a value');
            options.referredId = next;
            i += 1;
        } else if (arg.startsWith('--referred=')) {
            options.referredId = arg.slice('--referred='.length);
        } else if (arg === '--kind') {
            const next = argv[i + 1];
            if (!next) throw new Error('--kind requires a value');
            options.kind = assertPatronKind(next);
            i += 1;
        } else if (arg.startsWith('--kind=')) {
            options.kind = assertPatronKind(arg.slice('--kind='.length));
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
        throw new Error(
            'One of --grant, --offer, --ask, --witness, --register, --checkin, --referral, --balance, --standing, or --whisper must be specified.',
        );
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
            // E46 staffer UX: auto-generate a unique artifact id when the
            // staffer omits --artifact. The artifact is a free-text label for
            // the witnessed moment (e.g. "patrol-2026-06-01-evening"); we
            // synthesize a timestamp-based fallback so a real embassy clerk
            // doesn't have to learn yet another required-flag pattern.
            options.artifact = `witness-${residentSlug(options.residentName)}-${Date.now()}`;
        }
    }
    if (options.action === 'referral') {
        if (!options.referredId) {
            throw new Error('--referred <new-human> is required for --referral.');
        }
    }

    if (options.action === 'whisper') {
        if (!options.residentName) {
            throw new Error('--resident <name> is required for --whisper.');
        }
        if (!options.text || options.text.trim().length === 0) {
            throw new Error('--text <message> is required for --whisper.');
        }
    }

    return options;
}

export async function whisperRunningControllerViaMcp(input: RunningControllerWhisperInput): Promise<RunningControllerWhisperResult> {
    const client = new Client({ name: 'nullcity-patron-cli', version: '0.1.0' });
    await client.connect(
        new StreamableHTTPClientTransport(new URL(input.url), {
            requestInit: { headers: { Authorization: `Bearer ${input.token}` } },
        }),
    );
    try {
        const result = await client.callTool({
            name: 'patron_whisper',
            arguments: {
                human: input.humanId,
                resident: input.residentName,
                text: input.text,
            },
        });
        const text = firstTextContent(result);
        return JSON.parse(text) as RunningControllerWhisperResult;
    } finally {
        await client.close();
    }
}

export async function askRunningControllerViaMcp(input: RunningControllerAskInput): Promise<RunningControllerAskResult> {
    const client = new Client({ name: 'nullcity-patron-cli', version: '0.1.0' });
    await client.connect(
        new StreamableHTTPClientTransport(new URL(input.url), {
            requestInit: { headers: { Authorization: `Bearer ${input.token}` } },
        }),
    );
    try {
        const result = await client.callTool({
            name: 'patron_ask',
            arguments: {
                human: input.humanId,
                resident: input.residentName,
                text: input.text,
            },
        });
        const text = firstTextContent(result);
        return JSON.parse(text) as RunningControllerAskResult;
    } finally {
        await client.close();
    }
}

export async function offerRunningControllerViaMcp(input: RunningControllerOfferInput): Promise<RunningControllerOfferResult> {
    const client = new Client({ name: 'nullcity-patron-cli', version: '0.1.0' });
    await client.connect(
        new StreamableHTTPClientTransport(new URL(input.url), {
            requestInit: { headers: { Authorization: `Bearer ${input.token}` } },
        }),
    );
    try {
        const result = await client.callTool({
            name: 'patron_offer',
            arguments: {
                human: input.humanId,
                resident: input.residentName,
                amount: input.amount,
            },
        });
        const text = firstTextContent(result);
        return JSON.parse(text) as RunningControllerOfferResult;
    } finally {
        await client.close();
    }
}

function mcpConfigFromEnv(env: Record<string, string | undefined>): Pick<RunningControllerAskInput, 'url' | 'token'> | undefined {
    const token = env.CONTROLLER_MCP_TOKEN || firstToken(env.CONTROLLER_MCP_TOKENS);
    if (!token) {
        return undefined;
    }
    const explicitUrl = env.CONTROLLER_MCP_HTTP_URL;
    if (explicitUrl) {
        return { url: explicitUrl, token };
    }
    const port = env.CONTROLLER_MCP_HTTP_PORT;
    if (!port) {
        return undefined;
    }
    const host = env.CONTROLLER_MCP_HTTP_HOST || '127.0.0.1';
    const routePath = env.CONTROLLER_MCP_HTTP_PATH || '/controller/mcp';
    const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return { url: `http://${host}:${port}${normalizedPath}`, token };
}

function firstToken(value: string | undefined): string | undefined {
    return value
        ?.split(',')
        .map(token => token.trim())
        .filter(Boolean)[0];
}

function firstTextContent(value: unknown): string {
    const content = (value as { content?: Array<{ text?: string }> }).content || [];
    const first = content.find(item => typeof item.text === 'string');
    if (!first?.text) {
        throw new Error('MCP tool returned no text content');
    }
    return first.text;
}

function normalizeResidentName(name: string): string {
    const withoutGatewayPrefix = name.startsWith('resident:') ? name.slice('resident:'.length) : name;
    return withoutGatewayPrefix.startsWith('res:') ? withoutGatewayPrefix : `res:${withoutGatewayPrefix}`;
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
 * the SoulLoader + RuntimeStateStore + LibraryUpdater stack used by staff CLI
 * flows. It intentionally does not start a resident evidence session: the
 * running controller owns live trajectory/current pointers.
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
        throw new Error(`Failed to load resident soul for "${residentName}": ${err instanceof Error ? err.message : String(err)}`);
    }

    const currencyLedger = store.loadCurrency();
    const standingLedger = store.loadStanding();

    const stateStore = new RuntimeStateStore(config.memory.dir);
    const initialAttention = soul.frontmatter.attentionProfile?.startingAttention ?? 100;
    const legacyKind = soul.frontmatter.archetype ?? 'default';
    const state = stateStore.load(residentName, initialAttention, legacyKind);

    const evidence = {
        trajectory: {
            recordPatron: () => undefined,
        },
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
            console.log(`[patron:${verbTag}] Attention for "${residentName}" increased by ${amount}. New attention: ${state.attention}.`);
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
 * This is best-effort. Current controllers write trajectory lines under
 * `memory/<resident>/evidence/trajectory/current`; older CLI-only bundles
 * used one trajectory file per legacy session directory. Scan both so the
 * terminal can surface a live reply when the MCP path injects the ask into a
 * running controller, while preserving the offline fallback.
 */
export function findRecentSay(memoryDir: string, residentName: string, sinceTs: string, options: FindRecentSayOptions = {}): string | null {
    const slug = residentSlug(residentName);
    const candidates = recentTrajectoryCandidates(memoryDir, slug);
    let latestSay: { text: string; ts: string } | null = null;
    for (const trajectoryPath of candidates) {
        if (!fs.existsSync(trajectoryPath)) {
            continue;
        }
        const lines = fs.readFileSync(trajectoryPath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as {
                    kind?: string;
                    text?: string;
                    ts?: string;
                    cause?: string;
                    action?: { cause?: string };
                };
                if (
                    entry.kind === 'say' &&
                    typeof entry.text === 'string' &&
                    typeof entry.ts === 'string' &&
                    entry.ts > sinceTs &&
                    matchesRecentSayOptions(entry, options)
                ) {
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

function matchesRecentSayOptions(
    entry: { text?: string; cause?: string; action?: { cause?: string } },
    options: FindRecentSayOptions,
): boolean {
    if (options.cause && entry.cause !== options.cause && entry.action?.cause !== options.cause) {
        return false;
    }
    if (options.textIncludes && !entry.text?.includes(options.textIncludes)) {
        return false;
    }
    return true;
}

function recentTrajectoryCandidates(memoryDir: string, slug: string): string[] {
    const candidates: string[] = [];
    const evidenceRoot = path.join(memoryDir, slug, 'evidence');
    const evidenceTrajectoryDir = path.join(evidenceRoot, 'trajectory');
    const currentTrajectoryPath = path.join(evidenceTrajectoryDir, 'current');
    if (fs.existsSync(currentTrajectoryPath)) {
        candidates.push(resolveCurrentTrajectoryPath(currentTrajectoryPath, evidenceTrajectoryDir));
    }

    const indexPath = path.join(evidenceRoot, 'index.json');
    if (fs.existsSync(indexPath)) {
        try {
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
                currentSessionId?: string;
                sessions?: Array<{ sessionId?: string; trajectoryPath?: string }>;
            };
            const current =
                index.sessions?.find(session => session.sessionId === index.currentSessionId) ||
                index.sessions?.[index.sessions.length - 1];
            if (current?.trajectoryPath) {
                candidates.push(path.join(evidenceRoot, current.trajectoryPath));
            }
        } catch {
            // ignore corrupt evidence indexes; the legacy path may still work.
        }
    }

    const trajectoryRoot = path.join(memoryDir, slug, 'sessions');
    if (!fs.existsSync(trajectoryRoot)) {
        return uniquePaths(candidates);
    }
    const sessionDirs = fs.readdirSync(trajectoryRoot).filter(name => {
        try {
            return fs.statSync(path.join(trajectoryRoot, name)).isDirectory();
        } catch {
            return false;
        }
    });
    for (const sessionDir of sessionDirs) {
        const trajectoryPath = path.join(trajectoryRoot, sessionDir, 'trajectory.jsonl');
        candidates.push(trajectoryPath);
    }
    return uniquePaths(candidates);
}

function resolveCurrentTrajectoryPath(currentPath: string, trajectoryDir: string): string {
    try {
        if (fs.lstatSync(currentPath).isSymbolicLink()) {
            return fs.realpathSync(currentPath);
        }
        const maybeTarget = fs.readFileSync(currentPath, 'utf8').trim();
        if (maybeTarget && !maybeTarget.startsWith('{')) {
            return path.join(trajectoryDir, maybeTarget);
        }
        return currentPath;
    } catch {
        try {
            const maybeTarget = fs.readFileSync(currentPath, 'utf8').trim();
            if (maybeTarget && !maybeTarget.startsWith('{')) {
                return path.join(trajectoryDir, maybeTarget);
            }
        } catch {
            // fall through to the original path.
        }
        return currentPath;
    }
}

function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths)];
}

function logOfferStandingDelta(delta: NonNullable<PatronEventOutcome['standingDelta']>): void {
    console.log(`[patron:offer] Standing with faction "${delta.factionId}": ${delta.before} -> ${delta.after}`);
    if (delta.tierCrossed) {
        // E46 staffer UX: report EVERY tier crossed + matching letter count so
        // a multi-tier grant doesn't look single-tier in chat. `tiersCrossed`
        // is canonical (HD-040 / E38); fall back for stale outcomes.
        const tiers = delta.tiersCrossed && delta.tiersCrossed.length > 0 ? delta.tiersCrossed : [delta.tierCrossed];
        const letterCount = tiers.length;
        const letterWord = letterCount === 1 ? 'letter' : 'letters';
        console.log(`[patron:offer] Tiers crossed: ${tiers.join(', ')} (${letterCount} ${letterWord} dispatched)`);
    }
}

const PATRON_KINDS: ReadonlyArray<PatronRegisterKind> = ['patron_gift', 'patron_witness', 'patron_sponsor'];

function assertPatronKind(raw: string): PatronRegisterKind {
    if ((PATRON_KINDS as ReadonlyArray<string>).includes(raw)) {
        return raw as PatronRegisterKind;
    }
    throw new Error(`--kind must be one of ${PATRON_KINDS.join(' | ')}; got "${raw}"`);
}

/**
 * Append a patron entry to `controller.yml#patrons[]` atomically and
 * idempotently. HD-011 helper: event-day staff would otherwise hand-edit
 * the YAML to populate the attendee list, which is error-prone under door
 * pressure. This CLI lets them run a single line per attendee:
 *
 *     npm run patron:register -- --human alice@onion --kind patron_gift
 *
 * Re-running with the same handle is a no-op (returns the existing entry).
 * Re-running with a different kind for an existing handle is a no-op too —
 * the original registration wins. Use a YAML edit if you need to change
 * the kind of an already-registered patron.
 *
 * Returns:
 *   { added: true, total: N }   when the handle was newly appended
 *   { added: false, total: N }  when the handle was already present
 *
 * Throws on YAML parse / write failures.
 */
export interface RegisterPatronResult {
    added: boolean;
    total: number;
    handle: string;
    kind: PatronRegisterKind;
}

export function registerPatronInConfig(configPath: string, handle: string, kind: PatronRegisterKind): RegisterPatronResult {
    // Read raw YAML so we preserve formatting + comments + non-patron blocks
    // exactly. Don't round-trip through the typed parser — that would drop
    // any keys the typed parser doesn't know about.
    const raw = fs.readFileSync(configPath, 'utf8');
    const doc = yaml.load(raw);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        throw new Error(`${configPath} did not parse to a YAML mapping`);
    }
    const root = doc as Record<string, unknown>;
    const existing = Array.isArray(root.patrons) ? (root.patrons as Array<Record<string, unknown>>) : [];
    const present = existing.find(p => typeof p?.handle === 'string' && p.handle === handle);
    if (present) {
        const presentKind = typeof present.kind === 'string' ? (present.kind as PatronRegisterKind) : kind;
        return { added: false, total: existing.length, handle, kind: presentKind };
    }
    const nextPatrons = [...existing, { handle, kind }];
    root.patrons = nextPatrons;
    const nextYaml = yaml.dump(root, { lineWidth: 100, noRefs: true });
    // Atomic write: tmp file in the same dir + rename. Avoids torn writes
    // if the operator's process is interrupted mid-flush.
    const tmpPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, nextYaml, 'utf8');
    fs.renameSync(tmpPath, configPath);
    return { added: true, total: nextPatrons.length, handle, kind };
}

export async function runPatronCli(argv: string[], deps: PatronCliRuntimeDeps = {}): Promise<number> {
    try {
        const options = parsePatronCliArgs(argv);

        // HD-011 helper — register before loading the typed config so a
        // brand-new operator can add the first patron entry to an otherwise
        // valid controller.yml without needing every other section to be
        // typed-parser-clean first.
        if (options.action === 'register') {
            const result = registerPatronInConfig(options.configPath, options.humanId, options.kind);
            if (result.added) {
                console.log(`[patron:register] Added "${result.handle}" (kind: ${result.kind}) to ${options.configPath}.`);
                console.log(`[patron:register] controller.yml#patrons[] now has ${result.total} entr${result.total === 1 ? 'y' : 'ies'}.`);
                console.log('[patron:register] Restart the controller for the registry to take effect.');
            } else {
                console.log(`[patron:register] "${result.handle}" already registered (kind: ${result.kind}); no-op.`);
                console.log(`[patron:register] controller.yml#patrons[] has ${result.total} entr${result.total === 1 ? 'y' : 'ies'}.`);
            }
            return 0;
        }

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

        if (options.action === 'checkin') {
            const ledger = store.loadCurrency();
            const tracker = store.loadCheckIn(ledger);
            const result = tracker.checkIn(options.humanId);
            store.saveCurrency(ledger);
            store.saveCheckIn(tracker);
            if (result.credited) {
                console.log(`[patron:checkin] Credited +${result.shards} Shard(s) to "${options.humanId}" (daily check-in).`);
                console.log(`[patron:checkin] New balance: ${ledger.balance(options.humanId)} Shards.`);
            } else {
                console.log(`[patron:checkin] "${options.humanId}" already checked in today (UTC). No change.`);
                console.log(`[patron:checkin] Balance: ${ledger.balance(options.humanId)} Shards.`);
            }
            return 0;
        }

        if (options.action === 'referral') {
            const ledger = store.loadCurrency();
            const tracker = store.loadCheckIn(ledger);
            const result = tracker.recordWorkshopAttendance(options.referredId, { referredBy: options.humanId });
            store.saveCurrency(ledger);
            store.saveCheckIn(tracker);
            if (result.referralCredited) {
                console.log(
                    `[patron:referral] Credited +2 Shards to referrer "${options.humanId}" for introducing "${options.referredId}".`,
                );
                console.log(`[patron:referral] Referrer balance: ${ledger.balance(options.humanId)} Shards.`);
            } else {
                console.log(
                    `[patron:referral] No bonus credited — "${options.referredId}" was already referred, or self-referral attempted.`,
                );
                console.log(`[patron:referral] Referrer balance: ${ledger.balance(options.humanId)} Shards.`);
            }
            return 0;
        }

        if (options.action === 'balance') {
            const ledger = store.loadCurrency();
            const bal = ledger.balance(options.humanId);
            console.log(`[patron:balance] ${options.humanId}: ${bal} Shards`);
            return 0;
        }

        if (options.action === 'standing') {
            const standingLedger = store.loadStanding();
            const pts = standingLedger.points(options.humanId, options.faction);
            const tier = standingLedger.currentTier(options.humanId, options.faction);
            // Find the next user-facing tier above current points.
            const userFacingTiers = STANDING_TIERS.filter(t => t.name !== 'stranger');
            const nextTier = userFacingTiers.find(t => t.minPoints > pts);
            const nextLine = nextTier
                ? `next: ${nextTier.name} at ${nextTier.minPoints} pts (${nextTier.minPoints - pts} more)`
                : 'tier: officer (max tier reached)';
            const tierLabel = tier === 'stranger' ? 'stranger (no standing yet)' : tier;
            console.log(`[patron:standing] ${options.humanId} @ ${options.faction}: ${pts} pts | tier: ${tierLabel} | ${nextLine}`);
            return 0;
        }

        if (options.action === 'offer') {
            const residentName = normalizeResidentName(options.residentName);
            const liveConfig = mcpConfigFromEnv(deps.env || process.env);
            if (liveConfig) {
                const offerRunningController = deps.offerRunningController || offerRunningControllerViaMcp;
                const outcome = await offerRunningController({
                    ...liveConfig,
                    humanId: options.humanId,
                    residentName,
                    amount: options.amount,
                });

                if (!outcome.ok) {
                    throw new Error(`Live offer failed: ${outcome.error || 'unknown_error'}`);
                }

                console.log('[patron:offer] Live controller accepted the offer.');
                console.log(
                    `[patron:offer] Successfully offered ${options.amount} Shards from human "${options.humanId}" to resident "${residentName}".`,
                );
                console.log(`[patron:offer] Event ID: ${outcome.eventId}`);
                if (outcome.standingDelta) {
                    logOfferStandingDelta(outcome.standingDelta);
                }
                console.log(`[patron:offer] Inbox: http://127.0.0.1:43596/v1/inbox?human=${encodeURIComponent(options.humanId)}`);
                return 0;
            }

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
                    logOfferStandingDelta(outcome.standingDelta);
                }
                // E46 staffer UX: print the inbox URL hint so the staffer can
                // hand off the link without memorizing port + path. Uses the
                // standard EVENT-D2c letters HTTP port 43596 (HD-026 / HD-029).
                console.log(`[patron:offer] Inbox: http://127.0.0.1:43596/v1/inbox?human=${encodeURIComponent(options.humanId)}`);
                return 0;
            }
            throw new Error(`Offer failed: ${outcome.error}`);
        }

        if (options.action === 'ask') {
            const residentName = normalizeResidentName(options.residentName);
            const startedAt = new Date().toISOString();
            const liveConfig = mcpConfigFromEnv(deps.env || process.env);
            if (liveConfig) {
                const askRunningController = deps.askRunningController || askRunningControllerViaMcp;
                const outcome = await askRunningController({
                    ...liveConfig,
                    humanId: options.humanId,
                    residentName,
                    text: options.text,
                });

                if (!outcome.ok || !outcome.enqueued) {
                    throw new Error(`Live ask failed: ${outcome.error || 'not_enqueued'}`);
                }

                console.log(`[patron:ask] Live controller enqueued the question.`);
                console.log(`[patron:ask] Resident: "${residentName}"`);
                console.log(`[patron:ask] Human: "${options.humanId}"`);
                console.log(`[patron:ask]   "${options.text}"`);
                console.log(`[patron:ask] Event ID: ${outcome.eventId}`);

                const reply = await pollRecentSay(config.memory.dir, residentName, startedAt, {
                    cause: 'nervous:patron-ask-acknowledge',
                    textIncludes: options.humanId,
                });
                if (reply) {
                    console.log(`[patron:ask] Resident replied: "${reply}"`);
                } else {
                    console.log(`[patron:ask] No response captured within 5000ms. Check the dashboard trajectory for the live ask.`);
                }
                return 0;
            }

            const bundle = buildResidentBundle(options, config, store, 'ask');

            const outcome = await bundle.gateway.askResident(options.humanId, bundle.residentName, options.text);

            if (outcome.ok) {
                bundle.persistLedgers();
                console.log(`[patron:ask] Successfully asked resident "${bundle.residentName}" on behalf of human "${options.humanId}":`);
                console.log(`[patron:ask]   "${options.text}"`);
                console.log(`[patron:ask] Event ID: ${outcome.eventId}`);

                const reply = await pollRecentSay(config.memory.dir, bundle.residentName, startedAt);
                if (reply) {
                    console.log(`[patron:ask] Resident replied: "${reply}"`);
                } else {
                    console.log(
                        `[patron:ask] No response captured within 5000ms. The question was recorded; the Brain will see it on next wake.`,
                    );
                }
                return 0;
            }
            throw new Error(`Ask failed: ${outcome.error}`);
        }

        if (options.action === 'whisper') {
            const residentName = normalizeResidentName(options.residentName);
            const liveConfig = mcpConfigFromEnv(deps.env || process.env);
            if (liveConfig) {
                const whisperRunningController = deps.whisperRunningController || whisperRunningControllerViaMcp;
                const outcome = await whisperRunningController({
                    ...liveConfig,
                    humanId: options.humanId,
                    residentName,
                    text: options.text,
                });

                if (!outcome.ok) {
                    throw new Error(`Live whisper failed: ${outcome.error || 'unknown_error'}`);
                }

                console.log(`[patron:whisper] Live controller delivered the whisper.`);
                console.log(`[patron:whisper] Resident: "${residentName}"`);
                console.log(`[patron:whisper] Human: "${options.humanId}"`);
                console.log(`[patron:whisper]   "${options.text}"`);
                return 0;
            }

            // Offline fallback: write to a mock/temp bus
            console.log(`[patron:whisper] Offline fallback (in-memory LoreBus):`);
            const bus = new LoreBus();
            const published = publishWhisper(bus, {
                from: options.humanId,
                to: residentName,
                text: options.text,
                position: { x: 0, y: 0, level: 0 },
            });
            if (!published) {
                throw new Error('Whisper rejected (self-whisper or empty text)');
            }
            console.log(`[patron:whisper] Whisper published to offline LoreBus.`);
            return 0;
        }

        if (options.action === 'witness') {
            const bundle = buildResidentBundle(options, config, store, 'witness');

            const witnessAmount = options.amount > 0 ? options.amount : 3;
            const outcome = await bundle.gateway.witnessAt(options.humanId, options.artifact, bundle.residentName, witnessAmount);

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

async function pollRecentSay(
    memoryDir: string,
    residentName: string,
    startedAt: string,
    options: FindRecentSayOptions = {},
): Promise<string | null> {
    const pollTimeoutMs = 5000;
    const pollIntervalMs = 250;
    const deadline = Date.now() + pollTimeoutMs;
    let reply: string | null = null;
    while (Date.now() < deadline) {
        reply = findRecentSay(memoryDir, residentName, startedAt, options);
        if (reply) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    return reply;
}

if (require.main === module) {
    runPatronCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
