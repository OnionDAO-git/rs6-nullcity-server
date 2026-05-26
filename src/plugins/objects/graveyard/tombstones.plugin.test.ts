import { action } from './tombstones.plugin';
import { getTombstoneAt } from '../../../controller/embassy/graveyard';

jest.mock('../../../controller/embassy/graveyard', () => ({
    getTombstoneAt: jest.fn(),
}));

describe('Tombstone Object Plugin (Workstream N3)', () => {
    let mockPlayer: any;
    let mockObject: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockPlayer = {
            sendMessage: jest.fn(),
        };
        mockObject = {
            objectId: 402,
            x: 3241,
            y: 3193,
        };
    });

    it('sends tombstone description message when tombstone exists at coordinates', () => {
        (getTombstoneAt as jest.Mock).mockReturnValue({
            resident: 'res:hans',
            name: 'Hans Zimmer',
            faction: 'Saradomin',
            epitaph: 'The quiet life',
            livedTicks: 12000,
            cause: 'attention exhaustion',
        });

        action({
            player: mockPlayer,
            object: mockObject,
            option: 'read',
            objectConfig: {},
        } as any);

        expect(getTombstoneAt).toHaveBeenCalledWith(3241, 3193);
        expect(mockPlayer.sendMessage).toHaveBeenCalledWith(
            'Hans Zimmer, Saradomin. The quiet life. Lived 12000 ticks. Died of attention exhaustion.',
        );
    });

    it('sends fallback message when no tombstone exists at coordinates', () => {
        (getTombstoneAt as jest.Mock).mockReturnValue(null);

        action({
            player: mockPlayer,
            object: mockObject,
            option: 'examine',
            objectConfig: {},
        } as any);

        expect(getTombstoneAt).toHaveBeenCalledWith(3241, 3193);
        expect(mockPlayer.sendMessage).toHaveBeenCalledWith('An empty tombstone.');
    });
});
