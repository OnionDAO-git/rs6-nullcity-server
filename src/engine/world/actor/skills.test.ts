import { EventEmitter } from 'events';
import type { Player } from '@engine/world/actor/player/player';
import { Skill, Skills } from './skills';

jest.mock('chokidar', () => ({
    watch: jest.fn(),
}));

jest.mock('@server/game/game-server', () => ({
    serverConfig: { expRate: 1 },
}));

describe('Skills', () => {
    it('emits a level_up event when experience advances a player skill level', () => {
        const actor = {
            type: 'player',
            outgoingPackets: { updateSkill: jest.fn() },
            playerEvents: new EventEmitter(),
            enqueueBaseTask: jest.fn(),
        } as unknown as Player;
        const skills = new Skills(actor);
        const events: Array<{ skill: string; level: number }> = [];
        actor.playerEvents.on('level_up', event => events.push(event));

        skills.addExp(Skill.ATTACK, skills.getExpForLevel(2));

        expect(events).toEqual([{ skill: 'attack', level: 2 }]);
    });
});
