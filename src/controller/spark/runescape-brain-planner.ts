/**
 * RuneScape Brain planner helpers (Plan R-δ extraction).
 *
 * Hosts the LLM-driven goal-selection support code extracted from
 * `src/controller/thinking/hybrid-agent-thinking-module.ts`. These are the
 * Brain half of the Brain/Body/Nervous decomposition documented in
 * `docs/superpowers/specs/2026-05-22-spark-module-extraction-design.md`.
 *
 * Per the SPARK module extraction spec (Plan δ): each helper is moved
 * verbatim from the monolith — no semantic edits. The accompanying test
 * suite is the contract. Helpers extracted here continue to be imported
 * back into the monolith until the orchestrator slim-down (Plan ε).
 *
 * The orchestrator owns the LLM client + endpoint resolution; this file
 * owns the pure pieces of Brain inference: completion schemas, JSON
 * parsing, goal factories, and goal-identity predicates.
 */

import { z } from 'zod';
import type { ActiveGoalState } from '../memory/runtime-state';

// --- Brain completion Zod schemas (moved verbatim from the monolith). ---

/**
 * Schema describing the `goal` field of a Brain JSON completion. Mirrors the
 * monolith's local `brainGoalSchema`.
 */
export const brainGoalSchema = z.object({
    id: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(500),
    steps: z.array(z.string().min(1).max(200)).max(8).optional(),
    success: z.string().min(1).max(300).optional(),
    ttlTicks: z.number().int().positive().max(5000).optional(),
});

/**
 * Schema describing the full Brain JSON completion shape. Mirrors the
 * monolith's local `brainCompletionSchema`.
 */
export const brainCompletionSchema = z.object({
    cause: z.string().max(120).optional(),
    goal: brainGoalSchema.optional(),
    say: z.string().max(200).optional(),
});

/** Parsed Brain completion shape returned by `parseBrainCompletion`. */
export type BrainCompletion = {
    goal?: z.infer<typeof brainGoalSchema>;
    say?: string;
    cause?: string;
};

// --- JSON parsing helpers (moved verbatim from the monolith). ---

/**
 * Extracts the first JSON object found in `text` and returns the parsed
 * value. Tolerates surrounding prose. Throws if no JSON-like substring is
 * present. Mirrors the monolith's `extractJson`.
 */
export function extractJson(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
        return JSON.parse(trimmed.slice(first, last + 1));
    }

    return JSON.parse(trimmed);
}

// --- Goal-id slugify (moved verbatim from the monolith). ---

/**
 * Slugify a goal description into a stable kebab-case identifier. Used by
 * the orchestrator when the Brain returns a goal without an explicit id.
 * Mirrors the monolith's `goalId` helper.
 */
export function goalId(description: string): string {
    return description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

/**
 * Parse a Brain LLM completion into the structured Brain decision shape.
 * Returns an empty object when the text is empty or when the parsed object
 * does not match `brainCompletionSchema`. Throws when `extractJson` cannot
 * parse the text as JSON (matching monolith behavior verbatim — the caller
 * upstream of the LLM response is responsible for catching).
 * Mirrors the monolith's `parseBrainCompletion`.
 */
export function parseBrainCompletion(text: string): BrainCompletion {
    if (!text.trim()) {
        return {};
    }

    const parsed = brainCompletionSchema.safeParse(extractJson(text));
    if (!parsed.success) {
        return {};
    }
    return parsed.data;
}

// --- String / speech helpers (moved verbatim from the monolith). ---

/**
 * Trim whitespace and strip trailing sentence punctuation from a target
 * label. Used by `followGoal` and by the Brain output sanitation. Mirrors
 * the monolith's `cleanTarget` helper.
 */
export function cleanTarget(text: string): string {
    return text.trim().replace(/[.!?]+$/g, '');
}

/**
 * Sanitize a Brain `say` field for emission: trim, collapse internal
 * whitespace, truncate to 220 chars. Returns undefined for empty /
 * undefined input so callers can use `if (say) {...}` to gate emission.
 * Mirrors the monolith's `cleanSpeech` helper.
 */
export function cleanSpeech(text: string | undefined): string | undefined {
    const clean = text?.trim().replace(/\s+/g, ' ').slice(0, 220);
    return clean || undefined;
}

/**
 * Compact a goal description into a speech-friendly form: collapse
 * whitespace, strip trailing sentence punctuation, truncate (with ellipsis)
 * to either 96 or 160 chars depending on whether the caller needs to
 * reserve space for a follow-on step. Mirrors the monolith's
 * `summarizeGoalForSpeech` helper.
 */
export function summarizeGoalForSpeech(text: string, reserveSpaceForNextStep: boolean): string {
    const clean = text
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[.!?]+$/g, '');
    const max = reserveSpaceForNextStep ? 96 : 160;
    if (clean.length <= max) {
        return clean;
    }
    return `${clean
        .slice(0, max - 3)
        .trimEnd()
        .replace(/[,:;.!?]+$/g, '')}...`;
}

// --- Goal factories (moved verbatim from the monolith). ---

/**
 * Build the canonical `make-fire` Active Goal. Used when the Brain has not
 * selected a goal and the orchestrator wants to seed one from a benchmark
 * task or starter workflow.
 */
export function firemakingGoal(tick: number): ActiveGoalState {
    return {
        id: 'make-fire',
        description: 'Gather ordinary logs and light a fire with the tinderbox.',
        steps: ['Find a level-1 ordinary Tree or Dead tree', 'Chop it for logs', 'Use tinderbox on logs', 'Say what happened'],
        success: 'A fire appears nearby and I can still report my location.',
        ttlTicks: 600,
        createdAtTick: tick,
    };
}

/** Build the canonical `chop-level-one-tree` Active Goal. */
export function woodcuttingGoal(tick: number): ActiveGoalState {
    return {
        id: 'chop-level-one-tree',
        description: 'Practice woodcutting on ordinary level-1 trees and gather logs.',
        steps: ['Find a visible ordinary Tree or Dead tree', 'Move beside it', 'Use chop down', 'Repeat while staying findable'],
        success: 'Logs are collected or a tree-chopping attempt is underway.',
        ttlTicks: 600,
        createdAtTick: tick,
    };
}

/** Build the canonical `catch-starter-fish` Active Goal. */
export function starterFishingGoal(tick: number): ActiveGoalState {
    return {
        id: 'catch-starter-fish',
        description: 'Catch shrimp with a small fishing net at a visible Fishing spot.',
        steps: ['Carry a small fishing net', 'Find a Fishing spot', 'Move beside it', 'Use the net option'],
        success: 'A net fishing attempt is underway or raw shrimp are collected.',
        ttlTicks: 600,
        createdAtTick: tick,
    };
}

/** Build the canonical `catch-and-cook-starter-fish` Active Goal. */
export function starterFishingCookingGoal(tick: number): ActiveGoalState {
    return {
        id: 'catch-and-cook-starter-fish',
        description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
        steps: ['Carry a small fishing net', 'Catch raw shrimp or anchovies', 'Find or make a fire', 'Use raw fish on the fire or range'],
        success: 'Raw fish turn into cooked food or a clear blocker is explained.',
        ttlTicks: 900,
        createdAtTick: tick,
    };
}

/** Build the canonical `cook-starter-fish` Active Goal. */
export function starterCookingGoal(tick: number): ActiveGoalState {
    return {
        id: 'cook-starter-fish',
        description: 'Cook raw shrimp or anchovies on a visible fire or range.',
        steps: ['Carry raw shrimp or anchovies', 'Find a fire or range', 'Use raw fish on the heat source'],
        success: 'Raw fish turn into cooked food or a clear blocker is explained.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

/** Build the canonical `train-prayer-with-bones` Active Goal. */
export function prayerGoal(tick: number): ActiveGoalState {
    return {
        id: 'train-prayer-with-bones',
        description: 'Pick up bones and bury them to train Prayer after safe combat.',
        steps: ['Find bones on the ground or in inventory', 'Pick up visible bones', 'Use the bury option on carried bones'],
        success: 'Bones are buried and Prayer gains progress.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

/** Build the canonical `train-combat-safely` Active Goal. */
export function combatGoal(tick: number): ActiveGoalState {
    return {
        id: 'train-combat-safely',
        description: 'Train combat on safe low-level NPCs and stop when hurt.',
        steps: ['Find a safe Chicken, Rat, Cow, or Goblin', 'Move beside it', 'Attack when healthy', 'Eat or stop when hurt'],
        success: 'A safe creature is attacked while Agent remains healthy enough to continue.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

/**
 * Build a `follow-<slug>` Active Goal pointed at the named target. Falls
 * back to the literal label `target` when the input is empty.
 */
export function followGoal(targetName: string, tick: number): ActiveGoalState {
    const target = cleanTarget(targetName) || 'target';
    return {
        id: `follow-${goalId(target) || 'target'}`,
        description: `Follow ${target} and stay close enough to be seen.`,
        steps: ['Watch for the target nearby', 'Move back within follow radius when they walk away', 'Stop following if told'],
        success: `Agent remains within follow range of ${target}.`,
        ttlTicks: 900,
        createdAtTick: tick,
    };
}

/**
 * Map a benchmark task id to the canonical Active Goal the orchestrator
 * should seed when that benchmark is selected. Returns undefined for
 * unknown task ids.
 */
export function benchmarkGoalForTask(taskId: unknown, tick: number): ActiveGoalState | undefined {
    if (taskId === 'starter-fishing-5m') {
        return starterFishingGoal(tick);
    }
    if (taskId === 'fishing-cooking-10m') {
        return starterFishingCookingGoal(tick);
    }
    if (taskId === 'combat-prayer-10m') {
        return combatGoal(tick);
    }
    if (taskId === 'explore-report-5m') {
        return explorationGoal(tick);
    }
    return undefined;
}

/** Build the canonical `scout-nearby-area` Active Goal. */
export function explorationGoal(tick: number): ActiveGoalState {
    return {
        id: 'scout-nearby-area',
        description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
        steps: ['Walk toward a nearby landmark or person', 'Report what is visible', 'Return near the anchor if I drift too far'],
        success: 'A nearby landmark, actor, or item has been checked and I can report my location.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

// --- Goal-identity predicates (moved verbatim from the monolith). ---
//
// These predicates classify an Active Goal back to its workflow family.
// They are intentionally fuzzy regex matches over the goal's id +
// description + steps, so that user-authored or LLM-improvised goals can
// still be routed to the appropriate Body routine.

/** True when the goal looks like a prayer-training (bones / bury) goal. */
export function isPrayerTrainingGoal(goal: ActiveGoalState): boolean {
    if (/^train-combat|^combat/i.test(goal.id)) {
        return false;
    }
    return /prayer|bone|bones|bury/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

/** True when the goal looks like an exploration / scouting goal (description-based). */
export function isExplorationGoal(goal: ActiveGoalState): boolean {
    return /explore|scout|survey|look around|nearby|landmark|area/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`);
}

/** Stricter exploration test: requires id-level evidence too. */
export function isDedicatedExplorationGoal(goal: ActiveGoalState): boolean {
    return /explore|scout|survey|look around|landmark/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

/** True when the goal looks like a combat-training goal. */
export function isCombatTrainingGoal(goal: ActiveGoalState): boolean {
    return /combat|fight|fighting|attack|melee/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`);
}

/** True when the goal looks like a woodcutting-training goal. */
export function isWoodcuttingTrainingGoal(goal: ActiveGoalState): boolean {
    return /woodcut|chop|tree|gather logs/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

/** True when the goal looks like a starter-fishing goal. */
export function isStarterFishingGoal(goal: ActiveGoalState): boolean {
    return /fish|fishing|shrimp|anchov|small net|small_fishing_net|fishing spot/i.test(
        `${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`,
    );
}

/** True when the goal looks like a firemaking goal. */
export function isFiremakingGoal(goal: ActiveGoalState): boolean {
    return /fire|burn|tinderbox|light/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

/** True when the goal is a follow-someone goal. Handles undefined input. */
export function isFollowGoal(goal?: ActiveGoalState): boolean {
    if (!goal) {
        return false;
    }
    return /^follow-/i.test(goal.id) || /\bfollow\b/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`);
}
