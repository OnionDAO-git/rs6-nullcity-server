import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ActionAttempt } from '../actions/action-attempt';
import { FactionStockpileLedger, classifyFactionContribution } from './stockpile-ledger';

describe('FactionStockpileLedger', () => {
    it('records successful foundry firemaking work as persisted kindling', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faction-stockpile-'));
        const ledger = new FactionStockpileLedger(root, { now: () => new Date('2026-05-25T19:00:00.000Z') });

        const contribution = ledger.recordAttempt({
            resident: 'res:mother-anvil',
            factionId: 'foundry',
            attempt: attempt({
                action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'faction_foundry_fuel_work' },
            }),
        });

        expect(contribution).toEqual(
            expect.objectContaining({
                factionId: 'foundry',
                resident: 'res:mother-anvil',
                resource: 'kindling',
                amount: 1,
                actionKind: 'use_item_on_item',
                cause: 'faction_foundry_fuel_work',
            }),
        );
        expect(ledger.snapshot().totals.foundry?.kindling).toBe(1);

        const restored = FactionStockpileLedger.load(root);
        expect(restored.snapshot().totals.foundry?.kindling).toBe(1);
        expect(fs.existsSync(path.join(root, 'faction-stockpile.json'))).toBe(true);
    });

    it('ignores failures and landmark-return movement because they are not resource output', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faction-stockpile-'));
        const ledger = new FactionStockpileLedger(root);

        expect(
            ledger.recordAttempt({
                resident: 'res:mother-anvil',
                factionId: 'foundry',
                attempt: attempt({
                    finalStatus: 'timeout',
                    action: { kind: 'interact', target: { id: 'tree' }, option: 'chop-down', cause: 'faction_foundry_fuel_work' },
                }),
            }),
        ).toBeUndefined();
        expect(
            ledger.recordAttempt({
                resident: 'res:mother-anvil',
                factionId: 'foundry',
                attempt: attempt({
                    action: { kind: 'move_to', target: { x: 3015, y: 3357, level: 0 }, range: 6, cause: 'faction_landmark_return' },
                }),
            }),
        ).toBeUndefined();
        expect(ledger.snapshot().history).toEqual([]);
    });

    it('classifies live faction work causes into story resources', () => {
        expect(
            classifyFactionContribution(
                'bureau-of-continuity',
                attempt({ action: { kind: 'attack', target: { id: 'npc:80' }, cause: 'faction_bureau_witness_work' } }),
            ),
        ).toEqual(expect.objectContaining({ factionId: 'bureau-of-continuity', resource: 'witness_accounts' }));
        expect(
            classifyFactionContribution(
                'ledger',
                attempt({ action: { kind: 'move_to', target: { x: 3210, y: 3424, level: 0 }, cause: 'faction_ledger_audit_work' } }),
            ),
        ).toEqual(expect.objectContaining({ factionId: 'ledger', resource: 'audit_marks' }));
        expect(
            classifyFactionContribution(
                'veil',
                attempt({ action: { kind: 'move_to', target: { x: 3080, y: 3501, level: 0 }, cause: 'faction_veil_shadow_work' } }),
            ),
        ).toEqual(expect.objectContaining({ factionId: 'veil', resource: 'shadow_reports' }));
    });
});

function attempt(overrides: Partial<ActionAttempt> = {}): ActionAttempt {
    return {
        attemptId: 'attempt-test',
        resident: 'res:test',
        producer: 'body',
        submittedAt: '2026-05-25T19:00:00.000Z',
        action: { kind: 'say', text: 'working' },
        evidence: [],
        finalStatus: 'success',
        metadata: { tick: 123 },
        ...overrides,
    } as ActionAttempt;
}
