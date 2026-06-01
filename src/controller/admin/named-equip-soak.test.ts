import {
    actorRefFromPerception,
    parseNamedEquipSoakArgs,
    peerSpawnNearPerception,
    verifyNamedEquipSoakEvidence,
    type NamedEquipSoakInventoryItem,
    type NamedEquipSoakLogEntry,
} from './named-equip-soak';

describe('named equip soak verifier', () => {
    it('passes when ordinary logs show unequip setup followed by resident combat equip and attack', () => {
        const outcome = verifyNamedEquipSoakEvidence({
            resident: 'res:qa-survivor',
            entries: [
                log({ kind: 'unequip', equipmentSlot: 'main_hand' }),
                log({ kind: 'unequip', equipmentSlot: 'off_hand' }),
                log({ kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }),
                log({ kind: 'attack', cause: 'combat_train_attack' }),
            ],
            inventoryBefore: [item(315, 3)],
            inventoryAfterSetup: [item(315, 3), item(9703, 1), item(9704, 1)],
            inventoryAfter: [item(315, 3)],
            equipmentAfter: [item(9703, 1)],
            setupCommandSubmitted: 1,
            setupMode: 'unequip',
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            setupUnequipActions: 2,
            residentEquipActions: 1,
            postEquipAttacks: 1,
            setupCommandSubmitted: 1,
            usefulGearInInventoryAfterSetup: 2,
            usefulGearInEquipmentAfter: 1,
        });
    });

    it('fails when resident never emits an ordinary equip action after setup', () => {
        const outcome = verifyNamedEquipSoakEvidence({
            resident: 'res:qa-survivor',
            entries: [
                log({ kind: 'unequip', equipmentSlot: 'main_hand' }),
                log({ kind: 'unequip', equipmentSlot: 'off_hand' }),
                log({ kind: 'say', text: 'I am thinking.' }),
            ],
            inventoryBefore: [item(315, 3)],
            inventoryAfterSetup: [item(315, 3), item(9703, 1), item(9704, 1)],
            inventoryAfter: [item(315, 3), item(9703, 1), item(9704, 1)],
            equipmentAfter: [],
            setupCommandSubmitted: 1,
            setupMode: 'unequip',
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordinary action-log equip');
        expect(outcome.metrics.residentEquipActions).toBe(0);
    });

    it('parses defaults for the QA survivor equip soak', () => {
        expect(parseNamedEquipSoakArgs([], new Date('2026-05-30T15:16:00.000Z'))).toMatchObject({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa3-151600',
            commandPrefix: 'survive',
            setupMode: 'unequip',
            configPath: 'controller.yml',
            outputDir: 'data/benchmarks/capability-qa-2026-05-30',
        });
    });

    it('can verify a resident that starts with useful gear preloaded in inventory', () => {
        const outcome = verifyNamedEquipSoakEvidence({
            resident: 'res:qa-survivor',
            entries: [
                log({ kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }),
                log({ kind: 'attack', cause: 'combat_train_attack' }),
            ],
            inventoryBefore: [item(9703, 1), item(9704, 1)],
            inventoryAfterSetup: [item(9703, 1), item(9704, 1)],
            inventoryAfter: [],
            equipmentAfter: [item(9703, 1)],
            setupCommandSubmitted: 1,
            setupMode: 'preloaded-inventory',
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.setupUnequipActions).toBe(0);
        expect(outcome.summaries[0]).toContain('preloaded useful gear');
    });

    it('passes gear capability when equip succeeds even if combat engagement is handled by CQA5', () => {
        const outcome = verifyNamedEquipSoakEvidence({
            resident: 'res:qa-survivor',
            entries: [log({ kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' })],
            inventoryBefore: [item(9703, 1)],
            inventoryAfterSetup: [item(9703, 1)],
            inventoryAfter: [],
            equipmentAfter: [item(9703, 1)],
            setupCommandSubmitted: 1,
            setupMode: 'preloaded-inventory',
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.postEquipAttacks).toBe(0);
        expect(outcome.summaries[0]).toContain('combat engagement remains CQA5 scope');
    });

    it('accepts preloaded gear that was already equipped during the soak lookback window', () => {
        const outcome = verifyNamedEquipSoakEvidence({
            resident: 'res:qa-survivor',
            entries: [log({ kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' })],
            inventoryBefore: [],
            inventoryAfterSetup: [],
            inventoryAfter: [],
            equipmentAfter: [item(9703, 1)],
            setupCommandSubmitted: 1,
            setupMode: 'preloaded-inventory',
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.usefulGearInInventoryAfterSetup).toBe(0);
        expect(outcome.metrics.usefulGearInEquipmentAfter).toBe(1);
    });

    it('parses explicit preloaded-inventory setup mode', () => {
        expect(parseNamedEquipSoakArgs(['--setup-mode', 'preloaded-inventory'])).toMatchObject({
            setupMode: 'preloaded-inventory',
        });
    });

    it('places the command peer beside the target resident current perception', () => {
        expect(
            peerSpawnNearPerception({
                resident: {
                    position: { x: 3211, y: 3204, level: 0 },
                },
            }),
        ).toEqual({ x: 3210, y: 3204, level: 0 });
    });

    it('builds a live gateway actor ref from perception', () => {
        expect(
            actorRefFromPerception('res:qa-survivor', {
                resident: {
                    id: 'resident:res:qa-survivor',
                    name: 'QA Survivor',
                    position: { x: 3211, y: 3204, level: 0 },
                },
            }),
        ).toEqual({
            id: 'resident:res:qa-survivor',
            kind: 'resident',
            name: 'QA Survivor',
            position: { x: 3211, y: 3204, level: 0 },
        });
    });
});

function log(action: Record<string, unknown>): NamedEquipSoakLogEntry {
    return {
        t: '2026-05-30T15:20:00.000Z',
        source: 'thinking',
        action,
        result: { ok: true },
    };
}

function item(itemId: number, amount: number): NamedEquipSoakInventoryItem {
    return { itemId, amount };
}
