import fs from 'fs';
import os from 'os';
import path from 'path';
import { runStorytellerDryRun } from '../storyteller/cli';
import { NcriAdminCliError, parseNcriAdminCliArgs, runNcriAdminCli } from './cli';

describe('parseNcriAdminCliArgs', () => {
    it('parses seed and list commands with memory root', () => {
        expect(parseNcriAdminCliArgs(['seed', '--memory-root', '/tmp/mem'])).toEqual({ command: 'seed', memoryRoot: '/tmp/mem' });
        expect(parseNcriAdminCliArgs(['list', '--memory-root', '/tmp/mem'])).toEqual({ command: 'list', memoryRoot: '/tmp/mem' });
    });

    it('parses approve and price commands', () => {
        expect(parseNcriAdminCliArgs(['approve', '--memory-root', '/tmp/mem', '--id', 'ncri-1', '--admin-notes', 'ok'])).toEqual({
            command: 'approve',
            memoryRoot: '/tmp/mem',
            id: 'ncri-1',
            adminNotes: 'ok',
        });
        expect(
            parseNcriAdminCliArgs([
                'price',
                '--memory-root',
                '/tmp/mem',
                '--id',
                'ncri-1',
                '--ap-price',
                '150',
                '--gp-redemption-cost',
                '500',
                '--set-by',
                'admin',
            ]),
        ).toEqual({
            command: 'price',
            memoryRoot: '/tmp/mem',
            id: 'ncri-1',
            apPrice: 150,
            gpRedemptionCost: 500,
            setBy: 'admin',
        });
    });

    it('rejects missing required command-specific flags', () => {
        expect(() => parseNcriAdminCliArgs(['approve', '--memory-root', '/tmp/mem'])).toThrow(NcriAdminCliError);
        expect(() => parseNcriAdminCliArgs(['price', '--memory-root', '/tmp/mem', '--id', 'ncri-1'])).toThrow(/--ap-price/);
        expect(() => parseNcriAdminCliArgs(['demo-sale', '--memory-root', '/tmp/mem'])).toThrow(/--city-user-id/);
    });
});

describe('runNcriAdminCli', () => {
    let tempRoot: string;
    let memoryRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-cli-'));
        memoryRoot = path.join(tempRoot, 'memory');
        fs.mkdirSync(memoryRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('seeds defaults and lists them as approved marketplace records', async () => {
        const seeded = JSON.parse(
            await runNcriAdminCli(parseNcriAdminCliArgs(['seed', '--memory-root', memoryRoot]), {
                now: () => new Date('2026-05-30T19:30:00.000Z'),
            }),
        );
        expect(seeded).toMatchObject({ ok: true, command: 'seed', count: 3 });

        const listed = JSON.parse(await runNcriAdminCli(parseNcriAdminCliArgs(['list', '--memory-root', memoryRoot])));
        expect(listed.records).toHaveLength(3);
        expect(listed.records[0]).toMatchObject({
            displayName: 'Bronze Sword of First Light',
            approvalStatus: 'approved',
            saleStatus: 'listed',
        });
    });

    it('demo-sale creates a seeded NCRI sale that storyteller:dry-run can digest', async () => {
        const result = JSON.parse(
            await runNcriAdminCli(
                parseNcriAdminCliArgs([
                    'demo-sale',
                    '--memory-root',
                    memoryRoot,
                    '--fixture-id',
                    'bronze-sword-first-light',
                    '--city-user-id',
                    'demo@onion',
                ]),
                { now: () => new Date('2026-05-30T19:30:00.000Z') },
            ),
        );

        expect(result).toMatchObject({
            ok: true,
            command: 'demo-sale',
            fixtureId: 'bronze-sword-first-light',
            sale: {
                buyerCityUserId: 'demo@onion',
                apPrice: 150,
                gpRedemptionCost: 500,
                record: expect.objectContaining({ saleStatus: 'sold' }),
            },
        });

        const dryRun = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir: path.join(tempRoot, 'storyteller'),
                digestId: 'ncri-demo',
            },
            { now: () => new Date('2026-05-30T19:31:00.000Z') },
        );
        expect(dryRun.digest.ncriEvents).toEqual([
            expect.objectContaining({
                kind: 'ncri_created',
                evidence: expect.objectContaining({ ncriId: result.sale.ncriId }),
            }),
        ]);
    });
});
