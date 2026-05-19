import type { AgentAction } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Brain } from './brain';

export interface RemoteBrainTransport {
    publishPerception(perception: Perception): void;
    drainAcceptedActions(): AgentAction[];
}

export class RemoteBrain implements Brain {
    public constructor(private readonly transport: RemoteBrainTransport) {}

    public decide(perception: Perception): AgentAction[] {
        this.transport.publishPerception(perception);
        return this.transport.drainAcceptedActions();
    }
}
