import fs from 'fs';
import path from 'path';
import type { GoalName, Position, ResidentAssignment, SimulationState } from './types';

export function loadState(filePath: string): SimulationState {
    if (!fs.existsSync(filePath)) {
        return { version: 1, residents: [] };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SimulationState;
    return {
        version: 1,
        residents: Array.isArray(parsed.residents) ? parsed.residents : [],
    };
}

export function saveState(filePath: string, state: SimulationState): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(state, null, 4)}\n`);
    fs.renameSync(`${filePath}.tmp`, filePath);
}

export function upsertAssignment(
    state: SimulationState,
    name: string,
    goal: GoalName,
    options: { home?: Position; bornAt?: string; notes?: string } = {},
): ResidentAssignment {
    const normalized = name.toLowerCase();
    const existing = state.residents.find(resident => resident.name === normalized);
    const assignedAt = new Date().toISOString();

    if (existing) {
        existing.goal = goal;
        existing.assignedAt = assignedAt;
        existing.home = options.home || existing.home;
        existing.bornAt = options.bornAt || existing.bornAt;
        existing.notes = options.notes || existing.notes;
        return existing;
    }

    const assignment: ResidentAssignment = {
        name: normalized,
        goal,
        assignedAt,
        home: options.home,
        bornAt: options.bornAt,
        notes: options.notes,
    };
    state.residents.push(assignment);
    state.residents.sort((a, b) => a.name.localeCompare(b.name));
    return assignment;
}
