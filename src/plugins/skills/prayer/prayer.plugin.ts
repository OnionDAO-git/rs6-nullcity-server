import type { buttonActionHandler } from '@engine/action/pipe/button.action';
import type { objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import type { PlayerInitAction } from '@engine/action/pipe/player-init.action';
import { Task } from '@engine/task/task';
import { getPrayerState, PRAYER_RECHARGE_ALTARS, PRAYER_WIDGET_ID, PRAYERS_BY_BUTTON } from '@engine/world/actor/prayer';
import type { Player } from '@engine/world/actor/player/player';

class PrayerDrainTask extends Task {
    public constructor(private readonly player: Player) {
        super({ interval: 1, repeat: true });
    }

    public execute(): void {
        if (!this.player.isActive) {
            this.stop();
            return;
        }
        getPrayerState(this.player).tickDrain();
    }
}

const togglePrayer: buttonActionHandler = ({ player, buttonId }) => {
    const prayer = PRAYERS_BY_BUTTON.get(buttonId);
    if (!prayer) {
        return;
    }
    getPrayerState(player).toggle(prayer);
};

const initPrayer = ({ player }: PlayerInitAction): void => {
    const state = getPrayerState(player);
    state.deactivateAll(false);
    player.enqueueBaseTask(new PrayerDrainTask(player));
};

const rechargePrayer: objectInteractionActionHandler = ({ player }) => {
    getPrayerState(player).restore();
};

export default {
    pluginId: 'rs:prayer',
    hooks: [
        {
            type: 'player_init',
            handler: initPrayer,
        },
        {
            type: 'button',
            widgetId: PRAYER_WIDGET_ID,
            buttonIds: [...PRAYERS_BY_BUTTON.keys()],
            handler: togglePrayer,
            cancelActions: false,
        },
        {
            type: 'object_interaction',
            objectIds: PRAYER_RECHARGE_ALTARS,
            options: ['pray-at', 'pray', 'recharge'],
            walkTo: true,
            handler: rechargePrayer,
        },
    ],
};
