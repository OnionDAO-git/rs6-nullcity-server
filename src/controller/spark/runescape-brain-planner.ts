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
