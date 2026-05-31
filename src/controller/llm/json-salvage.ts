/**
 * Robust JSON salvage for LLM completions (packet S-INFER-1).
 *
 * Local quantized models — notably Qwen3 in thinking-mode — wrap their
 * reasoning in `<think>...</think>` blocks, fence their answer in markdown
 * code blocks, emit prose before the JSON, or leave a trailing comma. The
 * historical parsers in this codebase used a naive greedy
 * "first `{` to last `}`" slice + strict `JSON.parse`, which silently
 * discarded almost all of that output and reported it as `empty_completion`
 * (see HD-033 / intelligence-verification-log F20a).
 *
 * This module is the single shared salvage path. It:
 *   1. Strips `<think>...</think>` blocks (closed AND unclosed trailing).
 *   2. Extracts fenced ```json / ``` code blocks first.
 *   3. Walks balanced braces (quote/escape aware) to find candidate objects,
 *      rather than greedily slicing.
 *   4. Falls back to a lenient re-parse (trailing-comma tolerance) when
 *      strict JSON.parse fails.
 *   5. Returns a precise `SalvageClassification` so callers can record WHY a
 *      completion produced (or failed to produce) a usable object instead of
 *      blanket-labelling everything `empty_completion`.
 *
 * It is intentionally conservative: it never fabricates fields. Lenient
 * recovery only widens JSON tolerance; schema validation is always the gate.
 */

import type { ZodTypeAny, infer as zInfer } from 'zod';

/**
 * Why a completion produced (or did not produce) a schema-valid object.
 * Wired into the SPARK `decisionCause` so live action logs reveal the real
 * breakdown behind the old blanket `empty_completion`.
 */
export type SalvageClassification =
    | 'clean' //                     pure JSON object, parsed identically to the old path
    | 'recovered_after_think_strip' // JSON found after stripping think blocks / surrounding prose
    | 'recovered_from_fence' //       JSON found inside a ```json``` / ``` ``` code fence
    | 'recovered_trailing_comma' //   JSON parsed only after lenient trailing-comma cleanup
    | 'salvaged_lenient' //           no JSON object validated, but a bare field (e.g. quoted speech) was recovered
    | 'think_only_no_answer' //       model emitted think text (or truncated mid-think) with no JSON answer
    | 'schema_mismatch' //            valid JSON object(s) found, but none matched the schema
    | 'truly_empty'; //               whitespace / nothing usable at all

export interface SalvageResult<T> {
    /** The first schema-validated object, or undefined when none validated. */
    value?: T;
    classification: SalvageClassification;
    /** Whether at least one <think> block (or unclosed trailing think) was present. */
    hadThink: boolean;
    /** The candidate object strings that were tried (post-think-strip, post-fence). */
    candidates: string[];
}

const CLOSED_THINK = /<think>[\s\S]*?<\/think>/gi;
const OPEN_THINK = /<think>/i;

/**
 * Strip `<think>...</think>` blocks. Closed blocks are removed wholesale; an
 * unclosed trailing `<think>` (model truncated mid-thought) drops everything
 * from the opening tag onward so any JSON BEFORE it is still recoverable.
 */
export function stripThinkBlocks(text: string): string {
    let out = text.replace(CLOSED_THINK, '');
    const open = out.search(OPEN_THINK);
    if (open >= 0) {
        out = out.slice(0, open);
    }
    return out;
}

/** True iff the raw text contained any think tag (closed or unclosed). */
function hasThink(text: string): boolean {
    return OPEN_THINK.test(text);
}

/**
 * Extract the inner content of the first markdown code fence, if present.
 * Handles ```json ... ``` and bare ``` ... ```. Returns undefined when no
 * fence is found.
 */
function extractFenceContent(text: string): string | undefined {
    const match = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
    if (match && match[1].trim()) {
        return match[1];
    }
    return undefined;
}

/**
 * Scan `text` for balanced-brace JSON object candidates. Quote- and
 * escape-aware so braces inside string literals do not corrupt the slice.
 * Returns each top-level `{...}` span in document order.
 */
function scanBalancedObjects(text: string): string[] {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) {
                start = i;
            }
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) {
                    objects.push(text.slice(start, i + 1));
                    start = -1;
                }
            }
        }
    }
    return objects;
}

/**
 * Produce candidate JSON-object strings from a raw completion: strip think
 * blocks, prefer a code fence if present, then balanced-brace scan. Exported
 * for direct testing.
 */
export function salvageJsonCandidates(text: string): string[] {
    const stripped = stripThinkBlocks(text);
    if (!stripped.trim()) {
        return [];
    }
    const fenced = extractFenceContent(stripped);
    const haystack = fenced ?? stripped;
    return scanBalancedObjects(haystack);
}

/** Remove trailing commas before `}` or `]` so otherwise-valid JSON parses. */
function lenientStripTrailingCommas(text: string): string {
    return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Parse `text` into a schema-valid `T` using the full salvage ladder and
 * report a precise classification. Never throws. Never fabricates fields —
 * the schema is always the final gate.
 */
export function parseJsonWithSalvage<S extends ZodTypeAny>(text: string, schema: S): SalvageResult<zInfer<S>> {
    const hadThink = hasThink(text);

    if (!text.trim()) {
        return { classification: 'truly_empty', hadThink, candidates: [] };
    }

    const stripped = stripThinkBlocks(text);
    const fenced = extractFenceContent(stripped);
    const fromFence = fenced !== undefined;
    const haystack = fenced ?? stripped;
    const candidates = scanBalancedObjects(haystack);

    if (candidates.length === 0) {
        // No JSON object at all. If think text was present (closed or
        // truncated-open), this is the F20a think-only failure; otherwise the
        // model produced non-JSON / empty content.
        return { classification: hadThink ? 'think_only_no_answer' : 'truly_empty', hadThink, candidates };
    }

    let sawTrailingComma = false;
    let sawValidJsonWrongShape = false;

    for (const candidate of candidates) {
        let json: unknown;
        let usedLenient = false;
        try {
            json = JSON.parse(candidate);
        } catch {
            try {
                json = JSON.parse(lenientStripTrailingCommas(candidate));
                usedLenient = true;
            } catch {
                continue; // not parseable even leniently; try next candidate
            }
        }

        const parsed = schema.safeParse(json);
        if (parsed.success) {
            const classification: SalvageClassification = usedLenient
                ? 'recovered_trailing_comma'
                : fromFence
                  ? 'recovered_from_fence'
                  : isCleanWhole(text, candidate)
                    ? 'clean'
                    : 'recovered_after_think_strip';
            if (usedLenient) {
                sawTrailingComma = true;
            }
            return { value: parsed.data, classification, hadThink, candidates };
        }
        sawValidJsonWrongShape = true;
        if (usedLenient) {
            sawTrailingComma = true;
        }
    }

    // No candidate validated. Distinguish "valid JSON but wrong shape" from
    // "think text only" so the live breakdown is precise.
    void sawTrailingComma;
    if (sawValidJsonWrongShape) {
        return { classification: 'schema_mismatch', hadThink, candidates };
    }
    return { classification: hadThink ? 'think_only_no_answer' : 'truly_empty', hadThink, candidates };
}

/**
 * True when `candidate` is exactly the trimmed `text` (no think strip, no
 * fence, no surrounding prose) — i.e. the old strict path would have parsed
 * it identically. Used to preserve the `clean` classification.
 */
function isCleanWhole(text: string, candidate: string): boolean {
    return text.trim() === candidate.trim();
}
