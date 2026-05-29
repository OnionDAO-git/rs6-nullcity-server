import type {
    ActiveTrade,
    ActorRef,
    AgentActionShape,
    ItemRef,
    ObjectRef,
    PerceptionEvent,
    WorldItemRef,
} from '@engine/world/actor/resident/action/agent-action';
import type { SkillName } from '@engine/world/actor/skills';

export interface Perception {
    readonly tick: number;
    readonly resident: {
        readonly id: string;
        readonly position: { x: number; y: number; level: number };
        readonly hp: { current: number; max: number };
        readonly skills: Record<string, { level: number; xp: number }>;
        readonly combatLevel: number;
        readonly inCombat: boolean;

        readonly combatTarget: ActorRef | null;
        readonly busy: boolean;
        readonly inventory: ReadonlyArray<ItemRef | null>;
        readonly equipment: ReadonlyArray<ItemRef | null>;
        readonly activeTrade?: ActiveTrade;
        readonly quests?: Record<string, { progress: number | string; complete: boolean }>;
    };
    readonly nearby: {
        readonly players: ReadonlyArray<ActorRef>;
        readonly npcs: ReadonlyArray<ActorRef>;
        readonly worldItems: ReadonlyArray<WorldItemRef>;
        readonly objects: ReadonlyArray<ObjectRef>;
    };
    readonly events: ReadonlyArray<PerceptionEvent>;
    readonly availableActions: ReadonlyArray<AgentActionShape>;
}

export type PerceptionSkillName = SkillName | string;
