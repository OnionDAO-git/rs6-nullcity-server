import type { objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { getTombstoneAt } from '../../../controller/embassy/graveyard';

export const action: objectInteractionActionHandler = details => {
    const { player, object } = details;
    const tombstone = getTombstoneAt(object.x, object.y);

    if (tombstone) {
        const message = `${tombstone.name}, ${tombstone.faction}. ${tombstone.epitaph}. Lived ${tombstone.livedTicks} ticks. Died of ${tombstone.cause}.`;
        player.sendMessage(message);
    } else {
        player.sendMessage('An empty tombstone.');
    }
};

export default {
    pluginId: 'rs:tombstones',
    hooks: [
        {
            type: 'object_interaction',
            objectIds: [402],
            options: ['read', 'examine'],
            walkTo: true,
            handler: action,
        },
    ],
};
