import type { AgentAction } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Brain } from './brain';

export type ScriptedBrainHandler = (perception: Perception) => AgentAction[] | Promise<AgentAction[]>;

export class ScriptedBrain implements Brain {
    public constructor(private readonly handler: ScriptedBrainHandler = () => []) {}

    public decide(perception: Perception): AgentAction[] | Promise<AgentAction[]> {
        return this.handler(perception);
    }
}
