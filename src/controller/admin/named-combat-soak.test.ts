import {
    actorRefFromPerception,
    parseNamedCombatSoakArgs,
    peerSpawnNearPerception,
    verifyNamedCombatSoakEvidence,
    type NamedCombatSoakLogEntry,
} from './named-combat-soak';

describe('named combat soak verifier', () => {
    it('passes when ordinary named-resident logs show safe combat, survival, and no unsafe targets', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [
                log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'direct_chat_attack' }),
                log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_retaliate' }),
                log({ kind: 'item_action', option: 'bury', itemId: 526, cause: 'combat_bury_bones' }),
            ],
            events: [
                { kind: 'hit', amount: 1 },
                { kind: 'item_received', itemId: 526 },
                { kind: 'xp_gain', skill: 'Prayer', amount: 4.5 },
            ],
            commandSubmitted: 1,
            perceptionCount: 4,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            commandSubmitted: 1,
            safeAttackActions: 2,
            unsafeAttackActions: 0,
            deathEvents: 0,
            combatEvidence: 1,
            bonesEvidence: 1,
            prayerEvidence: 1,
        });
    });

    it('passes basic survival combat even when no bones drop during the short soak', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' })],
            events: [{ kind: 'hit', amount: 1 }],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.bonesEvidence).toBe(0);
        expect(outcome.summaries[0]).toContain('no bones/prayer proof');
    });

    it('passes required low-health recovery when fish, cook, eat, and later safe attack are ordered', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            requireLowHealthRecoveryChain: true,
            recoveryTargetName: 'goblin',
            entries: [
                log({ kind: 'move_to', target: { x: 3241, y: 3242, level: 0 }, range: 7, cause: 'low_health_fish_food' }),
                log({ kind: 'interact', option: 'net', target: safeNpc('Fishing spot'), cause: 'low_health_fish_food' }),
                log({ kind: 'use_item_on', itemSlot: 1, target: { key: 'rs:range', name: 'Range' }, cause: 'low_health_cook_food' }),
                log({ kind: 'eat', slot: 1, cause: 'nervous:eat-when-low-health' }),
                log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
            ],
            events: [{ kind: 'hit', amount: 1 }],
            commandSubmitted: 1,
            perceptionCount: 4,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            lowHealthRecoveryChain: 1,
            lowHealthFishActions: 1,
            lowHealthCookActions: 1,
            lowHealthEatActions: 1,
            lowHealthRecoveryReengageAttacks: 1,
        });
        expect(outcome.summaries[0]).toContain('fished, cooked, ate');
    });

    it('fails required low-health recovery if the safe attack happens before eating', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            requireLowHealthRecoveryChain: true,
            recoveryTargetName: 'goblin',
            entries: [
                log({ kind: 'interact', option: 'net', target: safeNpc('Fishing spot'), cause: 'low_health_fish_food' }),
                log({ kind: 'use_item_on', itemSlot: 1, target: { key: 'rs:range', name: 'Range' }, cause: 'low_health_cook_food' }),
                log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                log({ kind: 'eat', slot: 1, cause: 'nervous:eat-when-low-health' }),
            ],
            events: [{ kind: 'hit', amount: 1 }],
            commandSubmitted: 1,
            perceptionCount: 4,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordered low-health fish/cook/eat/reengage chain');
        expect(outcome.metrics).toMatchObject({
            lowHealthRecoveryChain: 0,
            lowHealthFishActions: 1,
            lowHealthCookActions: 1,
            lowHealthEatActions: 1,
            lowHealthRecoveryReengageAttacks: 0,
        });
    });

    it('fails required low-health recovery if reengage attacks a different safe target than requested', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            requireLowHealthRecoveryChain: true,
            recoveryTargetName: 'goblin',
            entries: [
                log({ kind: 'interact', option: 'net', target: safeNpc('Fishing spot'), cause: 'low_health_fish_food' }),
                log({ kind: 'use_item_on', itemSlot: 1, target: { key: 'rs:range', name: 'Range' }, cause: 'low_health_cook_food' }),
                log({ kind: 'eat', slot: 1, cause: 'low_health_eat' }),
                log({ kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' }),
            ],
            events: [{ kind: 'hit', amount: 1 }],
            commandSubmitted: 1,
            perceptionCount: 4,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics).toMatchObject({
            safeAttackActions: 1,
            lowHealthRecoveryChain: 0,
            lowHealthRecoveryReengageAttacks: 0,
        });
    });

    it('counts Lumbridge men as safe fallback combat proof', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [log({ kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' })],
            events: [{ kind: 'hit', amount: 1 }],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.safeAttackActions).toBe(1);
        expect(outcome.metrics.unsafeAttackActions).toBe(0);
    });

    it('does not count failed safe-target submissions as successful combat proof', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [
                log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'direct_chat_attack' }, { ok: false, reason: 'target_not_found' }),
            ],
            events: [],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordinary safe attack');
        expect(outcome.metrics).toMatchObject({
            attackActions: 1,
            safeAttackActions: 0,
            failedAttackActions: 1,
            combatEvidence: 0,
        });
    });

    it('fails if the resident attacks an unsafe target', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [log({ kind: 'attack', target: safeNpc('Guard'), cause: 'direct_chat_attack' })],
            events: [{ kind: 'hit', amount: 1 }],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('Unsafe combat target');
        expect(outcome.metrics.unsafeAttackActions).toBe(1);
    });

    it('fails if the soak command was submitted but no ordinary attack appears', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [log({ kind: 'say', text: 'I will be careful.' })],
            events: [],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordinary safe attack');
    });

    it('distinguishes low-health refusal from missing combat proof', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [log({ kind: 'say', text: 'My health is too low to fight right now.' })],
            events: [],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('refused combat while low on health');
        expect(outcome.metrics).toMatchObject({
            lowHealthRefusals: 1,
            safeAttackActions: 0,
        });
    });

    it('fails if a death event appears after combat starts', () => {
        const outcome = verifyNamedCombatSoakEvidence({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5',
            entries: [log({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' })],
            events: [{ kind: 'died' }],
            commandSubmitted: 1,
            perceptionCount: 2,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('resident died');
    });

    it('parses defaults for the QA survivor named combat soak', () => {
        expect(parseNamedCombatSoakArgs([], new Date('2026-05-30T15:52:00.000Z'))).toMatchObject({
            resident: 'res:qa-survivor',
            commandPeer: 'res:codex-cqa5-155200',
            commandPrefix: 'survive',
            targetName: 'goblin',
            configPath: 'controller.yml',
            outputDir: 'data/benchmarks/capability-qa-2026-05-30',
        });
    });

    it('parses the required low-health recovery chain flag', () => {
        expect(
            parseNamedCombatSoakArgs(['--require-low-health-recovery-chain'], new Date('2026-05-30T15:52:00.000Z')),
        ).toMatchObject({
            requireLowHealthRecoveryChain: true,
        });
    });

    it('places the command peer beside the target resident current perception', () => {
        expect(
            peerSpawnNearPerception({
                resident: {
                    position: { x: 3254, y: 3230, level: 0 },
                },
            }),
        ).toEqual({ x: 3253, y: 3230, level: 0 });
    });

    it('builds a live gateway actor ref from perception', () => {
        expect(
            actorRefFromPerception('res:qa-survivor', {
                resident: {
                    id: 'resident:res:qa-survivor',
                    name: 'QA Survivor',
                    position: { x: 3254, y: 3230, level: 0 },
                },
            }),
        ).toEqual({
            id: 'resident:res:qa-survivor',
            kind: 'resident',
            name: 'QA Survivor',
            position: { x: 3254, y: 3230, level: 0 },
        });
    });
});

function log(action: Record<string, unknown>, result: Record<string, unknown> = { ok: true }): NamedCombatSoakLogEntry {
    return {
        t: '2026-05-30T15:52:00.000Z',
        source: 'thinking',
        action,
        result,
    };
}

function safeNpc(name: string): Record<string, unknown> {
    return {
        id: `npc:${name.toLowerCase()}`,
        kind: 'npc',
        key: `rs:${name.toLowerCase().replaceAll(' ', '_')}`,
        name,
        position: { x: 3254, y: 3231, level: 0 },
        hpFraction: 0.5,
        combatLevel: name === 'Guard' ? 21 : 2,
    };
}
