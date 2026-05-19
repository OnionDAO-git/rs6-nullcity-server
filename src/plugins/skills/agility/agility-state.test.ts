jest.mock('@engine/world/actor/skills', () => ({
    Skill: {
        AGILITY: 16,
    },
}));

import { recordAgilityObstacle } from './agility-state';
import type { AgilityObstacle } from './agility-config';

function mockPlayer() {
    const player = {
        metadata: {},
        messages: [] as string[],
        xp: 0,
        skills: {
            addExp: jest.fn((_skill, amount) => {
                player.xp += amount;
            }),
        },
        sendMessage: jest.fn(message => player.messages.push(message)),
    };

    return player as any;
}

describe('agility course state', () => {
    let player: ReturnType<typeof mockPlayer>;

    beforeEach(() => {
        player = mockPlayer();
    });

    it('awards a lap only after the configured sequence completes in order', () => {
        const sequence = [
            'gnome_log_balance',
            'gnome_obstacle_net_1',
            'gnome_tree_branch_up',
            'gnome_balancing_rope',
            'gnome_tree_branch_down',
            'gnome_obstacle_net_2',
            'gnome_obstacle_pipe',
        ];

        sequence.forEach((key, sequence) => {
            recordAgilityObstacle(player, { key, courseId: 'gnome_stronghold', sequence } as AgilityObstacle);
        });

        expect(player.skills.addExp).toHaveBeenCalledTimes(1);
        expect(player.xp).toBe(39);
        expect(player.metadata.agility.courseProgress).toBeUndefined();
    });

    it('resets when the course is taken out of order', () => {
        const first = { key: 'gnome_log_balance', courseId: 'gnome_stronghold', sequence: 0 } as AgilityObstacle;
        const outOfOrder = { key: 'gnome_balancing_rope', courseId: 'gnome_stronghold', sequence: 3 } as AgilityObstacle;

        recordAgilityObstacle(player, first);
        recordAgilityObstacle(player, outOfOrder);

        expect(player.metadata.agility.courseProgress.nextSequence).toBe(0);
    });
});
