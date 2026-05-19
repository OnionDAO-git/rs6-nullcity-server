import type { AgentAction } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Resident } from '../resident';

export interface Brain {
    decide(perception: Perception): Promise<AgentAction[]> | AgentAction[];
    onAttach?(resident: Resident): Promise<void> | void;
    onDetach?(resident: Resident): Promise<void> | void;
}
