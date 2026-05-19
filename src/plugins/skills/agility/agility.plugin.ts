import type { ObjectInteractionActionHook, objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { Skill } from '@engine/world/actor/skills';
import { AgilityTask } from './agility-task';
import { agilityObstacleIds, getAgilityObstacle } from './agility-config';

const handleObstacle: objectInteractionActionHandler = details => {
    const obstacle = getAgilityObstacle(details.object.objectId, details.option);
    if (!obstacle) {
        return;
    }

    if (details.player.busy) {
        return;
    }

    if (!details.player.skills.hasLevel(Skill.AGILITY, obstacle.level)) {
        details.player.sendMessage(`You need an Agility level of ${obstacle.level} to use this obstacle.`, true);
        return;
    }

    details.player.enqueueTask(AgilityTask, [details.object, obstacle]);
};

export default {
    pluginId: 'rs:agility',
    hooks: [
        {
            type: 'object_interaction',
            objectIds: agilityObstacleIds,
            options: [
                'walk-across',
                'walk across',
                'balance',
                'climb',
                'climb-over',
                'climb over',
                'climb-up',
                'climb up',
                'climb-down',
                'climb down',
                'walk-on',
                'walk on',
                'squeeze-through',
                'squeeze through',
                'crawl-through',
                'crawl through',
                'jump-over',
                'jump over',
            ],
            walkTo: true,
            handler: handleObstacle,
        } as ObjectInteractionActionHook,
    ],
};
