import type { AgentAction } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Brain } from './brain';

const foodKeyPattern = /(food|bread|cake|meat|shrimp|trout|salmon|tuna|lobster|swordfish|shark|manta|karambwan)/i;

export class IdleBrain implements Brain {
    public decide(perception: Perception): AgentAction[] {
        const hp = perception.resident.hp;
        if (hp.max > 0 && hp.current / hp.max < 0.5) {
            const foodSlot = perception.resident.inventory.findIndex(item => item?.key && foodKeyPattern.test(item.key));
            if (foodSlot !== -1) {
                return [{ kind: 'eat', slot: foodSlot }];
            }
        }

        return [{ kind: 'noop' }];
    }
}
