import { loadControllerConfig } from '../config';
import { GatewayClient } from '../transport/gateway-client';
import type { InventoryEnsureItem, ResidentInventoryEnsureSummary } from '../transport/message-codecs';

export interface EnsureInventoryOptions {
    resident: string;
    item?: InventoryEnsureItem;
    amount: number;
    configPath: string;
}

export interface EnsureInventoryGateway {
    connect(): Promise<void>;
    hello(): Promise<void>;
    ensureInventoryItem(name: string, item: InventoryEnsureItem, amount: number): Promise<ResidentInventoryEnsureSummary>;
    close(): void;
}

export interface EnsureInventoryCliRuntime {
    gatewayFactory?: (options: EnsureInventoryOptions) => EnsureInventoryGateway;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
}

export function parseEnsureInventoryArgs(argv: string[]): EnsureInventoryOptions {
    const options: EnsureInventoryOptions = {
        resident: process.env.CONTROLLER_ENSURE_INVENTORY_RESIDENT || '',
        item: parseItemArg(process.env.CONTROLLER_ENSURE_INVENTORY_ITEM),
        amount: parsePositiveInt(process.env.CONTROLLER_ENSURE_INVENTORY_AMOUNT, 1),
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--resident') {
            options.resident = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--resident=')) {
            options.resident = arg.slice('--resident='.length);
        } else if (arg === '--item') {
            options.item = parseRequiredItem(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--item=')) {
            options.item = parseRequiredItem(arg.slice('--item='.length));
        } else if (arg === '--amount') {
            options.amount = parsePositiveInt(readRequiredValue(argv, ++i, arg), 1);
        } else if (arg.startsWith('--amount=')) {
            options.amount = parsePositiveInt(arg.slice('--amount='.length), 1);
        } else if (arg === '--config' || arg === '-c') {
            options.configPath = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else {
            throw new Error(`Unknown argument ${arg}`);
        }
    }

    if (!options.resident) {
        throw new Error('--resident <name> is required.');
    }
    if (options.item === undefined) {
        throw new Error('--item <id-or-key> is required.');
    }
    if (!Number.isInteger(options.amount) || options.amount <= 0) {
        throw new Error('--amount must be a positive integer.');
    }

    return options;
}

export async function runEnsureInventoryCli(argv: string[], runtime: EnsureInventoryCliRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (line => process.stdout.write(`${line}\n`));
    const stderr = runtime.stderr || (line => process.stderr.write(`${line}\n`));
    let gateway: EnsureInventoryGateway | undefined;
    try {
        const options = parseEnsureInventoryArgs(argv);
        gateway = runtime.gatewayFactory ? runtime.gatewayFactory(options) : createGateway(options);
        await gateway.connect();
        await gateway.hello();
        const result = await gateway.ensureInventoryItem(options.resident, options.item!, options.amount);
        stdout(JSON.stringify({ ok: true, ...result }));
        return 0;
    } catch (error) {
        stderr(`[controller:ensure-inventory] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    } finally {
        gateway?.close();
    }
}

function createGateway(options: EnsureInventoryOptions): EnsureInventoryGateway {
    const config = loadControllerConfig(options.configPath);
    return new GatewayClient({
        url: config.gateway.url,
        authToken: config.gateway.authToken,
        controllerId: `${config.gateway.controllerId}:ensure-inventory`,
        reconnect: false,
        requestTimeoutMs: 20_000,
    });
}

function parseRequiredItem(value: string): InventoryEnsureItem {
    const parsed = parseItemArg(value);
    if (parsed === undefined) {
        throw new Error('--item <id-or-key> is required.');
    }
    return parsed;
}

function parseItemArg(value: string | undefined): InventoryEnsureItem | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }
    return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (value === undefined || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function readRequiredValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (!value) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}

if (require.main === module) {
    runEnsureInventoryCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
