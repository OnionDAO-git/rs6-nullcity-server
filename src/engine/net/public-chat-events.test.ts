import { activeWorld } from '@engine/world';
import { isResident } from '@engine/world/actor/util';
import { publishPublicChatToNearbyResidents } from './public-chat-events';

jest.mock('@engine/world', () => ({
    activeWorld: {
        playerList: [],
    },
}));

jest.mock('@engine/world/actor/util', () => ({
    isResident: jest.fn(),
}));

function setPlayerList(players: unknown[]): void {
    (activeWorld as unknown as { playerList: unknown[] }).playerList = players;
}

describe('public chat resident events', () => {
    it('emits nearby human public chat into resident perception', () => {
        const player = {
            username: 'Codex',
            position: { x: 3200, y: 3201, level: 0 },
            instance: { instanceId: 'main' },
            skills: {
                hitpoints: { level: 10 },
                getMaxLevel: jest.fn(() => 10),
            },
            equals: jest.fn(other => other === player),
        };
        const resident = {
            residentId: 'resident:res:agent',
            isActive: true,
            position: { x: 3203, y: 3204, level: 0 },
            emitPerceptionEvent: jest.fn(),
            equals: jest.fn(() => false),
        };
        const otherHuman = {
            username: 'Other',
            isActive: true,
            position: { x: 3203, y: 3204, level: 0 },
            equals: jest.fn(() => false),
        };

        setPlayerList([player, resident, otherHuman]);
        jest.mocked(isResident).mockImplementation(candidate => (candidate as unknown) === resident);

        publishPublicChatToNearbyResidents(player as never, ' agent come here ');

        expect(resident.emitPerceptionEvent).toHaveBeenCalledWith({
            kind: 'chat',
            from: {
                id: 'player:codex',
                kind: 'player',
                name: 'Codex',
                position: { x: 3200, y: 3201, level: 0 },
                hpFraction: 1,
            },
            text: 'agent come here',
            to: 'public',
        });
        expect(otherHuman.equals).toHaveBeenCalled();
    });

    it('ignores residents too far away from the speaking player', () => {
        const player = {
            username: 'Codex',
            position: { x: 3200, y: 3201, level: 0 },
            skills: {
                hitpoints: { level: 10 },
                getMaxLevel: jest.fn(() => 10),
            },
            equals: jest.fn(other => other === player),
        };
        const resident = {
            residentId: 'resident:res:agent',
            isActive: true,
            position: { x: 3300, y: 3300, level: 0 },
            emitPerceptionEvent: jest.fn(),
            equals: jest.fn(() => false),
        };

        setPlayerList([player, resident]);
        jest.mocked(isResident).mockImplementation(candidate => (candidate as unknown) === resident);

        publishPublicChatToNearbyResidents(player as never, 'agent come here');

        expect(resident.emitPerceptionEvent).not.toHaveBeenCalled();
    });
});
