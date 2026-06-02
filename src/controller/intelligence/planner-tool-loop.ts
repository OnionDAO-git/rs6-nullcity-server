/**
 * RIQ-1-1-A: Brain tool-calling substrate (Phase 1 spike).
 *
 * Gives the Brain a pull-based knowledge interface: instead of relying
 * solely on pre-injected RAG, the Brain can emit a single tool-call JSON
 * object, receive the result, and then produce its normal goal/say output.
 *
 * The loop:
 *   1. First LLM completion — if the output matches the tool-call schema,
 *      execute the named tool with the given query.
 *   2. Append the tool result to the prompt and run a second completion.
 *   3. Return the final text plus an audit record of what tools fired.
 *
 * On any failure (parse error, unknown tool, tool execution error, nooped
 * completion) the loop falls back gracefully: it returns the original text
 * without crashing and sets `fellBackToRag = true`. Callers can then use
 * their normal RAG-injected path as if no tool call occurred.
 *
 * Currently ships one tool: `lookup_skill` (wraps the knowledge retriever).
 * Adding more tools later is a one-line `toolRegistry.set(...)` call.
 */

import { z } from 'zod';
import type { LlmClient, LlmRequest } from '../llm/llm-client';
import { parseJsonWithSalvage, stripThinkBlocks } from '../llm/json-salvage';
import { ENGINE_KNOWLEDGE_ENTRIES, retrieveKnowledge, formatKnowledgeForPrompt } from '../knowledge/knowledge-retriever';

export const PLANNER_TOOL_MAX_TURNS = 2; // first completion (possible tool call) + follow-up

/** A tool the Brain can call during its deliberation. */
export interface ToolDefinition {
    name: string;
    description: string;
    exampleQuery: string;
}

/** Audit record of a tool call made during one brain invocation. */
export interface ToolCallRecord {
    tool: string;
    query: string;
    result: string;
    turnIndex: number;
    executedMs: number;
}

export interface PlannerToolLoopResult {
    /** The final LLM completion text (to be parsed by the normal brain parser). */
    finalText: string;
    /** All tool calls made in this invocation (max 1 per current design). */
    toolCallsMade: ToolCallRecord[];
    /**
     * True when the loop could not complete a tool call and the returned
     * `finalText` is the raw first-completion text. The caller should treat
     * this as if no tool loop ran (i.e. rely on the RAG-injected context).
     */
    fellBackToRag: boolean;
    turns: number;
}

// Schema used to detect whether the Brain chose to issue a tool call.
const toolCallSchema = z.object({
    tool: z.string().min(1),
    query: z.string().min(1),
});

export type ToolFn = (query: string) => string;

// ---------------------------------------------------------------------------
// Built-in tool: lookup_skill
// ---------------------------------------------------------------------------

export const LOOKUP_SKILL_TOOL: ToolDefinition = {
    name: 'lookup_skill',
    description: 'Look up RuneScape knowledge: skill training methods, item locations, NPC coords, XP rates.',
    exampleQuery: 'firemaking training methods and requirements',
};

/**
 * Execute the `lookup_skill` tool against the built-in knowledge entries.
 * Returns a formatted string the Brain can read (capped at ~1200 chars).
 */
export function lookupSkill(query: string): string {
    const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, query, { limit: 3 });
    if (!results.length) {
        return `No knowledge entries matched "${query}".`;
    }
    return formatKnowledgeForPrompt(results, { maxChars: 1200 });
}

/** Default tool registry used by `runPlannerToolLoop`. */
export function defaultToolRegistry(): Map<string, ToolFn> {
    const m = new Map<string, ToolFn>();
    m.set(LOOKUP_SKILL_TOOL.name, lookupSkill);
    return m;
}

// ---------------------------------------------------------------------------
// Prompt injection helper
// ---------------------------------------------------------------------------

/**
 * Returns a short block of text that can be appended to the brain prompt to
 * tell the model about available tools. Returns an empty string when no tools
 * are provided (so the caller can gate tool support cleanly).
 */
export function buildToolInstructions(tools: ToolDefinition[]): string {
    if (!tools.length) return '';
    const list = tools.map(t => `  - ${t.name}: ${t.description}`).join('\n');
    return (
        '\n---\nYou may call ONE tool before your final answer.\n' +
        'To call a tool output ONLY valid JSON on its own line: ' +
        '{"tool":"<name>","query":"<question>"}\n' +
        'Then the tool result will be shown and you continue with your normal goal/say JSON.\n' +
        'If no tool lookup is needed, skip straight to your goal/say JSON.\n' +
        'Available tools:\n' +
        list +
        '\n---'
    );
}

// ---------------------------------------------------------------------------
// Core multi-turn loop
// ---------------------------------------------------------------------------

/**
 * Run the Brain with optional tool-calling support.
 *
 * - If the first completion is a tool call JSON, execute the tool, append the
 *   result to the prompt, and run a second completion (the final answer).
 * - If the first completion is NOT a tool call, return it directly (zero
 *   overhead compared to the plain `llmClient.complete` path).
 * - On any error or noop, fall back to the first-completion text.
 */
export async function runPlannerToolLoop(options: {
    llmClient: LlmClient;
    request: LlmRequest;
    tools: ToolDefinition[];
    toolRegistry: Map<string, ToolFn>;
    maxTurns?: number;
}): Promise<PlannerToolLoopResult> {
    const maxTurns = options.maxTurns ?? PLANNER_TOOL_MAX_TURNS;
    const toolCallsMade: ToolCallRecord[] = [];

    // Turn 0: first completion
    const firstResponse = await options.llmClient.complete(options.request);
    const firstText = firstResponse.text ?? '';

    if (firstResponse.nooped || !firstText) {
        return { finalText: firstText, toolCallsMade, fellBackToRag: false, turns: 1 };
    }

    // Fast path: if no tools supplied, return immediately (no parse overhead)
    if (!options.tools.length || !options.toolRegistry.size) {
        return { finalText: firstText, toolCallsMade, fellBackToRag: false, turns: 1 };
    }

    // Attempt to parse a tool call from the first completion
    const stripped = stripThinkBlocks(firstText);
    const parsed = parseJsonWithSalvage(stripped, toolCallSchema);

    if (!parsed.value || !options.toolRegistry.has(parsed.value.tool)) {
        // Not a tool call — normal brain output, return as-is
        return { finalText: firstText, toolCallsMade, fellBackToRag: false, turns: 1 };
    }

    // Execute the tool
    const { tool, query } = parsed.value;
    const toolFn = options.toolRegistry.get(tool)!;
    const startMs = Date.now();
    let toolResult: string;
    try {
        toolResult = toolFn(query);
    } catch {
        // Tool failed — fall back to the first-completion text
        return { finalText: firstText, toolCallsMade, fellBackToRag: true, turns: 1 };
    }
    const executedMs = Date.now() - startMs;

    toolCallsMade.push({ tool, query, result: toolResult, turnIndex: 0, executedMs });

    if (maxTurns < 2) {
        // Caller capped turns before a follow-up was possible
        return { finalText: firstText, toolCallsMade, fellBackToRag: true, turns: 1 };
    }

    // Turn 1: inject tool result and get the final answer
    const followUpPrompt =
        options.request.prompt + `\n\nTool result for ${tool}("${query}"):\n${toolResult}\n\nNow produce your goal/say JSON:`;

    const followUpRequest: LlmRequest = {
        ...options.request,
        prompt: followUpPrompt,
    };

    const followUpResponse = await options.llmClient.complete(followUpRequest);
    const followUpText = followUpResponse.text ?? '';

    if (followUpResponse.nooped || !followUpText) {
        // Follow-up nooped — fall back to first text
        return { finalText: firstText, toolCallsMade, fellBackToRag: true, turns: 2 };
    }

    return { finalText: followUpText, toolCallsMade, fellBackToRag: false, turns: 2 };
}
