import type { AgentAction, GoalName, Perception, Position, ResidentAssignment } from './types';

export interface GoalDecisionContext {
    assignment: ResidentAssignment;
    perception: Perception;
    actionIntervalTicks: number;
}

export class GoalPlanner {
    private readonly lastActionTick = new Map<string, number>();
    private readonly rng = new Map<string, () => number>();

    nextAction(context: GoalDecisionContext): AgentAction | null {
        const tick = context.perception.tick || 0;
        const lastTick = this.lastActionTick.get(context.assignment.name) ?? -Infinity;
        if (tick - lastTick < context.actionIntervalTicks || context.perception.resident?.busy) {
            return null;
        }

        const action = this.plan(context.assignment.goal, context);
        if (action) {
            this.lastActionTick.set(context.assignment.name, tick);
        }
        return action;
    }

    private plan(goal: GoalName, context: GoalDecisionContext): AgentAction | null {
        switch (goal) {
            case 'collect_items':
                return this.collectItems(context) || this.wander(context);
            case 'talk_to_npcs':
                return this.talkToNpcs(context) || this.wander(context);
            case 'socialize':
                return this.socialize(context) || this.wander(context);
            case 'work_loop':
                return this.workLoop(context) || this.wander(context);
            case 'survive':
                return this.survive(context) || this.wander(context);
            case 'wander':
            default:
                return this.wander(context);
        }
    }

    private collectItems(context: GoalDecisionContext): AgentAction | null {
        const item = context.perception.nearby?.worldItems?.[0];
        return item ? { kind: 'interact', target: item, option: 'pick-up' } : null;
    }

    private talkToNpcs(context: GoalDecisionContext): AgentAction | null {
        const npc = context.perception.nearby?.npcs?.[0];
        return npc ? { kind: 'interact', target: npc, option: 'talk-to' } : null;
    }

    private socialize(context: GoalDecisionContext): AgentAction | null {
        const players = context.perception.nearby?.players || [];
        if (!players.length) {
            return null;
        }
        const target = players[0].name || players[0].id;
        return { kind: 'say', text: `Working near ${target}.` };
    }

    private workLoop(context: GoalDecisionContext): AgentAction | null {
        const object = context.perception.nearby?.objects?.[0];
        if (object) {
            return { kind: 'interact', target: object, option: 'action-1' };
        }
        return this.collectItems(context);
    }

    private survive(context: GoalDecisionContext): AgentAction | null {
        const hp = context.perception.resident?.hp;
        if (hp && hp.max > 0 && hp.current / hp.max < 0.35) {
            return { kind: 'say', text: 'I need to get somewhere safer.' };
        }
        const npc = context.perception.nearby?.npcs?.[0];
        return npc ? { kind: 'attack', target: npc } : null;
    }

    private wander(context: GoalDecisionContext): AgentAction | null {
        const position = context.perception.resident?.position;
        if (!position) {
            return { kind: 'noop', cause: 'missing_position' };
        }

        const home = context.assignment.home || position;
        const random = this.randomFor(context.assignment.name);
        const target = clampNearHome(
            {
                x: position.x + Math.floor(random() * 9) - 4,
                y: position.y + Math.floor(random() * 9) - 4,
                level: position.level,
            },
            home,
            12,
        );
        return { kind: 'move_to', target };
    }

    private randomFor(name: string): () => number {
        let random = this.rng.get(name);
        if (!random) {
            random = seededRandom(hashString(name));
            this.rng.set(name, random);
        }
        return random;
    }
}

function clampNearHome(target: Required<Position>, home: Position, radius: number): Required<Position> {
    const homeLevel = home.level ?? target.level;
    return {
        x: Math.max(home.x - radius, Math.min(home.x + radius, target.x)),
        y: Math.max(home.y - radius, Math.min(home.y + radius, target.y)),
        level: homeLevel,
    };
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function seededRandom(seed: number): () => number {
    let state = seed || 1;
    return () => {
        state = Math.imul(1664525, state) + 1013904223;
        return ((state >>> 0) % 1000000) / 1000000;
    };
}
