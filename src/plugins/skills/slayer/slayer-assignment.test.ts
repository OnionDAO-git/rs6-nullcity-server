import { npcMatchesAssignment, selectSlayerAssignment } from './slayer-assignment';
import { slayerMasters } from './slayer-config';

describe('slayer assignment helpers', () => {
    it('selects an assignment with deterministic count', () => {
        const assignment = selectSlayerAssignment(slayerMasters[0], 1, () => 0);

        expect(assignment).toEqual({ group: 'goblins', displayName: 'goblins', remaining: 5 });
    });

    it('matches npc keys against the assigned group', () => {
        expect(npcMatchesAssignment('rs:goblin', { group: 'goblins', displayName: 'goblins', remaining: 3 })).toBe(true);
        expect(npcMatchesAssignment('rs:man', { group: 'goblins', displayName: 'goblins', remaining: 3 })).toBe(false);
    });
});
