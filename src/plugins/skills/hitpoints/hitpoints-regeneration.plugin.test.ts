import { HitpointsRegenerationTask, regenerateHitpoints } from './hitpoints-regeneration.plugin';

describe('hitpoints regeneration', () => {
    it('restores one hitpoint below max and sends a skill update', () => {
        const player = mockPlayer({ current: 3, max: 10 });

        const restored = regenerateHitpoints(player);

        expect(restored).toBe(true);
        expect(player.skills.hitpoints.level).toBe(4);
        expect(player.outgoingPackets.updateSkill).toHaveBeenCalledWith(3, 4, 1154);
    });

    it('does nothing at max hitpoints', () => {
        const player = mockPlayer({ current: 10, max: 10 });

        const restored = regenerateHitpoints(player);

        expect(restored).toBe(false);
        expect(player.skills.hitpoints.level).toBe(10);
        expect(player.outgoingPackets.updateSkill).not.toHaveBeenCalled();
    });

    it('stops its task when the player is inactive', () => {
        const player = mockPlayer({ current: 3, max: 10, active: false });
        const task = new HitpointsRegenerationTask(player);

        task.execute();

        expect(task.isActive).toBe(false);
        expect(player.skills.hitpoints.level).toBe(3);
    });
});

function mockPlayer(options: { current: number; max: number; active?: boolean }) {
    const hitpoints = { level: options.current, exp: 1154 };
    return {
        isActive: options.active ?? true,
        skills: {
            hitpoints,
            getMaxLevel: jest.fn(() => options.max),
            getSkillId: jest.fn(() => 3),
        },
        outgoingPackets: {
            updateSkill: jest.fn(),
        },
    };
}
