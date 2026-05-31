#!/usr/bin/env node
import { CityIntegrationService } from '../city-integration/service';
import { NcriPricingStore } from './ncri-pricing-store';
import { NcriRegistry } from './ncri-registry';
import { DEFAULT_NCRI_SEED_FIXTURES, seedNcriFixtures } from './seed-fixtures';

export type NcriAdminCommand = 'list' | 'approve' | 'price' | 'seed' | 'demo-sale';

export interface NcriAdminCliArgs {
    command: NcriAdminCommand;
    memoryRoot: string;
    id?: string;
    adminNotes?: string;
    apPrice?: number;
    gpRedemptionCost?: number;
    setBy?: string;
    fixtureId?: string;
    cityUserId?: string;
    idempotencyKey?: string;
}

export interface RunNcriAdminCliOptions {
    now?: () => Date;
}

export class NcriAdminCliError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'NcriAdminCliError';
    }
}

export function parseNcriAdminCliArgs(argv: string[]): NcriAdminCliArgs {
    const [commandRaw, ...rest] = argv;
    if (commandRaw === '--help' || commandRaw === '-h' || commandRaw === undefined) {
        throw new NcriAdminCliError(commandRaw === undefined ? 'missing_command' : 'help', usage());
    }
    if (!isCommand(commandRaw)) {
        throw new NcriAdminCliError('unknown_command', `unknown NCRI command: ${commandRaw}`);
    }

    let memoryRoot: string | undefined;
    let id: string | undefined;
    let adminNotes: string | undefined;
    let apPrice: number | undefined;
    let gpRedemptionCost: number | undefined;
    let setBy: string | undefined;
    let fixtureId: string | undefined;
    let cityUserId: string | undefined;
    let idempotencyKey: string | undefined;

    for (let i = 0; i < rest.length; i++) {
        const flag = rest[i];
        const read = (name: string): string => {
            const inline = inlineValue(flag, name);
            if (inline !== undefined) return inline;
            const next = rest[i + 1];
            if (!next) throw new NcriAdminCliError('missing_value', `${name} requires a value`);
            i++;
            return next;
        };

        if (flag === '--help' || flag === '-h') {
            throw new NcriAdminCliError('help', usage());
        } else if (flag === '--memory-root' || flag.startsWith('--memory-root=')) {
            memoryRoot = read('--memory-root');
        } else if (flag === '--id' || flag.startsWith('--id=')) {
            id = read('--id');
        } else if (flag === '--admin-notes' || flag.startsWith('--admin-notes=')) {
            adminNotes = read('--admin-notes');
        } else if (flag === '--ap-price' || flag.startsWith('--ap-price=')) {
            apPrice = parseNonnegativeInteger(read('--ap-price'), '--ap-price');
        } else if (flag === '--gp-redemption-cost' || flag.startsWith('--gp-redemption-cost=')) {
            gpRedemptionCost = parseNonnegativeInteger(read('--gp-redemption-cost'), '--gp-redemption-cost');
        } else if (flag === '--set-by' || flag.startsWith('--set-by=')) {
            setBy = read('--set-by');
        } else if (flag === '--fixture-id' || flag.startsWith('--fixture-id=')) {
            fixtureId = read('--fixture-id');
        } else if (flag === '--city-user-id' || flag.startsWith('--city-user-id=')) {
            cityUserId = read('--city-user-id');
        } else if (flag === '--idempotency-key' || flag.startsWith('--idempotency-key=')) {
            idempotencyKey = read('--idempotency-key');
        } else {
            throw new NcriAdminCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    if (!memoryRoot) throw new NcriAdminCliError('missing_memory_root', '--memory-root is required');
    if ((commandRaw === 'approve' || commandRaw === 'price') && !id) {
        throw new NcriAdminCliError('missing_id', '--id is required');
    }
    if (commandRaw === 'price') {
        if (apPrice === undefined) throw new NcriAdminCliError('missing_ap_price', '--ap-price is required');
        if (gpRedemptionCost === undefined) {
            throw new NcriAdminCliError('missing_gp_redemption_cost', '--gp-redemption-cost is required');
        }
    }
    if (commandRaw === 'demo-sale' && !cityUserId) {
        throw new NcriAdminCliError('missing_city_user_id', '--city-user-id is required');
    }

    return pruneUndefined({
        command: commandRaw,
        memoryRoot,
        id,
        adminNotes,
        apPrice,
        gpRedemptionCost,
        setBy,
        fixtureId,
        cityUserId,
        idempotencyKey,
    }) as NcriAdminCliArgs;
}

export async function runNcriAdminCli(args: NcriAdminCliArgs, options: RunNcriAdminCliOptions = {}): Promise<string> {
    const now = options.now ?? (() => new Date());
    const registry = new NcriRegistry(args.memoryRoot, now);
    const pricingStore = new NcriPricingStore(args.memoryRoot, now);

    if (args.command === 'list') {
        const prices = pricingStore.allLatest();
        return toJson({
            ok: true,
            command: args.command,
            records: registry.list().map(record => pruneUndefined({ ...record, pricing: prices.get(record.id) })),
        });
    }

    if (args.command === 'approve') {
        const record = registry.approve(required(args.id, '--id'), args.adminNotes);
        return toJson({ ok: true, command: args.command, record });
    }

    if (args.command === 'price') {
        const ncriId = required(args.id, '--id');
        const pricing = pricingStore.setPrice(ncriId, {
            pricingMode: 'admin-fixed',
            apPrice: required(args.apPrice, '--ap-price'),
            gpRedemptionCost: required(args.gpRedemptionCost, '--gp-redemption-cost'),
            setBy: args.setBy,
        });
        const record = registry.listForSale(ncriId);
        return toJson({ ok: true, command: args.command, record, pricing });
    }

    if (args.command === 'seed') {
        const results = seedNcriFixtures({ memoryRoot: args.memoryRoot, now });
        return toJson({ ok: true, command: args.command, count: results.length, results });
    }

    const fixtureId = args.fixtureId ?? DEFAULT_NCRI_SEED_FIXTURES[0].fixtureId;
    const seeded = seedNcriFixtures({ memoryRoot: args.memoryRoot, now });
    const fixture = seeded.find(result => result.fixtureId === fixtureId);
    if (!fixture) {
        throw new NcriAdminCliError('unknown_fixture', `unknown fixture id: ${fixtureId}`);
    }
    const service = makeDemoService(args.memoryRoot, now);
    const sale = await service.buyNcri(fixture.ncriId, {
        idempotencyKey: args.idempotencyKey ?? `ncri-demo-sale:${fixtureId}:${required(args.cityUserId, '--city-user-id')}`,
        cityUserId: required(args.cityUserId, '--city-user-id'),
        apPrice: fixture.pricing.apPrice,
        sourceId: `ncri-demo-sale:${fixtureId}`,
    });
    return toJson({ ok: true, command: args.command, fixtureId, sale });
}

function makeDemoService(memoryRoot: string, now: () => Date): CityIntegrationService {
    return new CityIntegrationService({
        memoryRoot,
        now,
        getRuntime: () => undefined,
        inventory: {
            inspectResidentGold: async resident => ({ resident, itemId: 995, amount: 0 }),
            burnResidentGold: async (resident, amount) => ({ resident, itemId: 995, burnedAmount: amount, remainingAmount: 0 }),
        },
        birth: {
            birthResident: async input => ({ resident: input.residentName, created: true, connected: false }),
        },
    });
}

function isCommand(value: string): value is NcriAdminCommand {
    return value === 'list' || value === 'approve' || value === 'price' || value === 'seed' || value === 'demo-sale';
}

function inlineValue(flag: string, name: string): string | undefined {
    const prefix = `${name}=`;
    return flag.startsWith(prefix) ? flag.slice(prefix.length) : undefined;
}

function parseNonnegativeInteger(value: string, flag: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new NcriAdminCliError('invalid_integer', `${flag} must be a non-negative integer`);
    }
    return parsed;
}

function required<T>(value: T | undefined, name: string): T {
    if (value === undefined) throw new NcriAdminCliError('missing_value', `${name} is required`);
    return value;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function toJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function usage(): string {
    return [
        'Usage:',
        '  npm run ncri:list -- --memory-root <path>',
        '  npm run ncri:approve -- --memory-root <path> --id <ncri-id> [--admin-notes <text>]',
        '  npm run ncri:price -- --memory-root <path> --id <ncri-id> --ap-price <n> --gp-redemption-cost <n> [--set-by <admin>]',
        '  npm run ncri:seed -- --memory-root <path>',
        '  npm run ncri:demo-sale -- --memory-root <path> --city-user-id <id> [--fixture-id <id>]',
    ].join('\n');
}

async function main(): Promise<void> {
    try {
        const args = parseNcriAdminCliArgs(process.argv.slice(2));
        process.stdout.write(`${await runNcriAdminCli(args)}\n`);
    } catch (error) {
        if (error instanceof NcriAdminCliError) {
            if (error.code === 'help') {
                process.stdout.write(`${error.message}\n`);
                process.exit(0);
            }
            process.stderr.write(`Error: ${error.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw error;
    }
}

if (require.main === module) {
    void main();
}
