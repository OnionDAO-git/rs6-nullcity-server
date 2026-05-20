import fs from 'fs';
import path from 'path';
import type { ActionResult, AgentAction, Perception, SimulationConfig } from './types';

export interface BugClassification {
    severity: 'info' | 'warning' | 'error';
    kind: 'unimplemented' | 'missing_content' | 'world_state' | 'infrastructure' | 'goal_mismatch';
    reason: string;
}

export class SimulationReporter {
    constructor(private readonly config: SimulationConfig) {}

    perception(resident: string, perception: Perception): void {
        if (this.config.runtime.logFullPerceptions) {
            this.append('perceptions', { resident, perception });
            return;
        }

        this.append('perceptions', {
            resident,
            tick: perception.tick,
            position: perception.resident?.position,
            nearby: {
                players: perception.nearby?.players?.length || 0,
                npcs: perception.nearby?.npcs?.length || 0,
                worldItems: perception.nearby?.worldItems?.length || 0,
                objects: perception.nearby?.objects?.length || 0,
            },
            events: perception.events?.map(event => event.kind).filter(Boolean) || [],
        });
    }

    action(resident: string, action: AgentAction, result?: ActionResult): void {
        this.append('actions', { resident, action, result });
        if (result && !result.ok) {
            const bug = classifyActionResult(result);
            if (bug) {
                this.bug(resident, bug, { action, result });
            }
        }
    }

    event(resident: string | undefined, category: string, payload: Record<string, unknown>): void {
        this.append('events', { resident, category, ...payload });
    }

    bug(resident: string | undefined, classification: BugClassification, details: Record<string, unknown>): void {
        this.append('bugs', { resident, ...classification, details });
    }

    private append(stream: string, payload: Record<string, unknown>): void {
        const date = new Date().toISOString().slice(0, 10);
        const dir = path.join(this.config.paths.logDir, stream);
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${date}.jsonl`), `${JSON.stringify({ t: new Date().toISOString(), ...payload })}\n`);
    }
}

export function classifyActionResult(result: ActionResult): BugClassification | undefined {
    if (result.ok || !result.reason) {
        return undefined;
    }

    const reason = result.reason;
    if (reason === 'unknown_action' || reason.startsWith('unsupported_')) {
        return { severity: 'error', kind: 'unimplemented', reason };
    }
    if (reason.endsWith('_config_not_found') || reason === 'spell_not_found') {
        return { severity: 'error', kind: 'missing_content', reason };
    }
    if (reason === 'target_not_found' || reason === 'object_config_not_found') {
        return { severity: 'warning', kind: 'world_state', reason };
    }
    if (reason.includes('timeout') || reason.includes('closed') || reason.startsWith('gateway_')) {
        return { severity: 'error', kind: 'infrastructure', reason };
    }
    if (reason.startsWith('empty_') || reason === 'no_active_trade' || reason === 'target_not_player') {
        return { severity: 'info', kind: 'goal_mismatch', reason };
    }

    return { severity: 'warning', kind: 'unimplemented', reason };
}
