import { loadControllerConfig } from '../config';
import { buildWallSnapshot, redactWallSnapshot, type WallSnapshot } from '../letters/wall-snapshot';
import type { Letter } from '../patron/letters-producer';
import { LettersStore } from '../patron/letters-store';
import { runPatronCli } from '../patron/cli';

export interface PatronLoopSmokeOptions {
    configPath: string;
    humanId: string;
    residentName: string;
    amount: number;
    http: boolean;
    lettersBaseUrl: string;
}

interface InboxPayload {
    letters?: Letter[];
}

const DEFAULT_AMOUNT = 10;
const DEFAULT_LETTERS_BASE_URL = 'http://127.0.0.1:43596';

export function parsePatronLoopSmokeArgs(argv: string[]): PatronLoopSmokeOptions {
    const options: PatronLoopSmokeOptions = {
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        humanId: `codex-patron-smoke-${Date.now()}@onion`,
        residentName: 'res:hans',
        amount: DEFAULT_AMOUNT,
        http: false,
        lettersBaseUrl: process.env.CONTROLLER_LETTERS_HTTP_BASE_URL || DEFAULT_LETTERS_BASE_URL,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--human') {
            const next = argv[i + 1];
            if (!next) throw new Error('--human requires a value');
            options.humanId = next;
            i += 1;
        } else if (arg.startsWith('--human=')) {
            options.humanId = arg.slice('--human='.length);
        } else if (arg === '--resident') {
            const next = argv[i + 1];
            if (!next) throw new Error('--resident requires a value');
            options.residentName = normalizeResidentName(next);
            i += 1;
        } else if (arg.startsWith('--resident=')) {
            options.residentName = normalizeResidentName(arg.slice('--resident='.length));
        } else if (arg === '--amount') {
            const next = argv[i + 1];
            if (!next) throw new Error('--amount requires a value');
            options.amount = parsePositiveInteger(next, '--amount');
            i += 1;
        } else if (arg.startsWith('--amount=')) {
            options.amount = parsePositiveInteger(arg.slice('--amount='.length), '--amount');
        } else if (arg === '--http') {
            options.http = true;
        } else if (arg === '--letters-base-url') {
            const next = argv[i + 1];
            if (!next) throw new Error('--letters-base-url requires a value');
            options.lettersBaseUrl = next;
            i += 1;
        } else if (arg.startsWith('--letters-base-url=')) {
            options.lettersBaseUrl = arg.slice('--letters-base-url='.length);
        } else {
            throw new Error(`Unknown argument ${arg}`);
        }
    }

    options.residentName = normalizeResidentName(options.residentName);
    if (!options.humanId.trim()) throw new Error('--human cannot be empty');
    return options;
}

export async function runPatronLoopSmokeCli(argv: string[]): Promise<number> {
    try {
        const options = parsePatronLoopSmokeArgs(argv);
        const config = loadControllerConfig(options.configPath);
        const residentName = normalizeResidentName(options.residentName);
        const startedAt = new Date().toISOString();

        console.log(`[patron:smoke] proving patron loop for ${options.humanId} -> ${residentName} (${options.amount} Shards)`);

        await requireCliSuccess(
            'grant',
            runPatronCli(['--grant', '--human', options.humanId, '--amount', String(options.amount), '--config', options.configPath]),
        );
        await requireCliSuccess(
            'offer',
            runPatronCli([
                '--offer',
                '--human',
                options.humanId,
                '--resident',
                residentName,
                '--amount',
                String(options.amount),
                '--config',
                options.configPath,
            ]),
        );

        const store = new LettersStore(config.memory.dir);
        const inboxLetters = store.readInbox(options.humanId);
        const standingLetter = findProofLetter(inboxLetters, residentName, startedAt);
        if (!standingLetter) {
            throw new Error(`private inbox has no new standing tier letter for ${options.humanId}`);
        }
        console.log('PASS private inbox has a standing tier letter');

        const localWall = redactWallSnapshot(
            buildWallSnapshot(config.memory.dir, {
                now: new Date(),
                limit: 25,
                residentIds: config.residents,
            }),
        );
        requireRedactedWallProof(localWall, standingLetter, 'local wall snapshot');
        console.log('PASS local wall snapshot redacts public letter recipients');

        if (options.http) {
            await verifyHttpProof(options, residentName, startedAt, standingLetter);
        } else {
            console.log('SKIP HTTP inbox/wall route check (pass --http to verify the live letters server)');
        }

        console.log(
            `[patron:smoke] Inbox: ${trimTrailingSlash(options.lettersBaseUrl)}/v1/inbox?human=${encodeURIComponent(options.humanId)}`,
        );
        return 0;
    } catch (error) {
        console.error(`[patron:smoke] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

async function requireCliSuccess(label: string, promise: Promise<number>): Promise<void> {
    const code = await promise;
    if (code !== 0) {
        throw new Error(`${label} command failed with exit code ${code}`);
    }
}

function findProofLetter(letters: Letter[], residentName: string, sinceTs: string): Letter | undefined {
    return letters.find(
        letter =>
            letter.kind === 'standing_tier_crossed' &&
            letter.senderResident === residentName &&
            letter.dispatchedAt >= sinceTs &&
            letter.body.trim().length > 0,
    );
}

function requireRedactedWallProof(snapshot: WallSnapshot, proofLetter: Letter, label: string): void {
    const wallLetter = snapshot.recentLetters.find(
        letter =>
            letter.kind === proofLetter.kind &&
            letter.senderResident === proofLetter.senderResident &&
            letter.subject === proofLetter.subject &&
            letter.dispatchedAt === proofLetter.dispatchedAt,
    );
    if (!wallLetter) {
        throw new Error(`${label} is missing the proof letter`);
    }
    if (wallLetter.body !== '') {
        throw new Error(`${label} leaked a letter body`);
    }
    if (!wallLetter.recipient.includes('***')) {
        throw new Error(`${label} did not redact recipient handle`);
    }
}

async function verifyHttpProof(
    options: PatronLoopSmokeOptions,
    residentName: string,
    startedAt: string,
    proofLetter: Letter,
): Promise<void> {
    const baseUrl = trimTrailingSlash(options.lettersBaseUrl);
    const inboxPayload = (await fetchJson(`${baseUrl}/v1/inbox?human=${encodeURIComponent(options.humanId)}`)) as InboxPayload;
    const httpLetter = findProofLetter(inboxPayload.letters || [], residentName, startedAt);
    if (!httpLetter) {
        throw new Error('HTTP inbox route did not serve the proof letter');
    }
    console.log('PASS HTTP inbox route serves the letter');

    const wallPayload = (await fetchJson(`${baseUrl}/v1/wall/snapshot`)) as WallSnapshot;
    requireRedactedWallProof(wallPayload, proofLetter, 'HTTP wall route');
    console.log('PASS HTTP wall route serves a redacted snapshot');
}

async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return response.json();
}

function normalizeResidentName(name: string): string {
    const withoutGatewayPrefix = name.startsWith('resident:') ? name.slice('resident:'.length) : name;
    return withoutGatewayPrefix.startsWith('res:') ? withoutGatewayPrefix : `res:${withoutGatewayPrefix}`;
}

function parsePositiveInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

if (require.main === module) {
    runPatronLoopSmokeCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
