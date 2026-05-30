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
