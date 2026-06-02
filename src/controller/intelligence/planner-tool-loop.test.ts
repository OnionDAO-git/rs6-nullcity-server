import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import {
    LOOKUP_SKILL_TOOL,
    PLANNER_TOOL_MAX_TURNS,
    buildToolInstructions,
    defaultToolRegistry,
    lookupSkill,
    runPlannerToolLoop,
} from './planner-tool-loop';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLlm(responses: Array<Partial<LlmResponse>>): LlmClient {
    let call = 0;
    return {
        complete: async (_req: LlmRequest): Promise<LlmResponse> => {
            const resp = responses[call] ?? responses[responses.length - 1];
            call++;
            return { text: '', nooped: false, ...resp };
        },
    } as unknown as LlmClient;
}

const baseRequest: LlmRequest = {
    endpoint: 'default',
    prompt: 'What should I do to train Firemaking?',
};

// ---------------------------------------------------------------------------
// buildToolInstructions
// ---------------------------------------------------------------------------

describe('buildToolInstructions', () => {
    it('returns empty string when no tools are provided', () => {
        expect(buildToolInstructions([])).toBe('');
    });

    it('includes the tool name and description', () => {
        const block = buildToolInstructions([LOOKUP_SKILL_TOOL]);
        expect(block).toContain(LOOKUP_SKILL_TOOL.name);
        expect(block).toContain(LOOKUP_SKILL_TOOL.description);
    });

    it('instructs the model to output a JSON tool-call object', () => {
        const block = buildToolInstructions([LOOKUP_SKILL_TOOL]);
        expect(block).toContain('"tool"');
        expect(block).toContain('"query"');
    });
});

// ---------------------------------------------------------------------------
// lookupSkill
// ---------------------------------------------------------------------------

describe('lookupSkill', () => {
    it('returns a non-empty string for a known skill keyword', () => {
        const result = lookupSkill('firemaking');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns a not-found message when no entries score above threshold', () => {
        // Tokenizer strips digits and short tokens; this yields zero scorable terms
        const result = lookupSkill('12345 67890');
        expect(result).toContain('No knowledge entries matched');
    });
});

// ---------------------------------------------------------------------------
// defaultToolRegistry
// ---------------------------------------------------------------------------

describe('defaultToolRegistry', () => {
    it('contains lookup_skill', () => {
        const registry = defaultToolRegistry();
        expect(registry.has('lookup_skill')).toBe(true);
    });

    it('lookup_skill tool fn returns a string', () => {
        const registry = defaultToolRegistry();
        const fn = registry.get('lookup_skill')!;
        expect(typeof fn('woodcutting')).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// runPlannerToolLoop — no-tool-call fast path
// ---------------------------------------------------------------------------

describe('runPlannerToolLoop — no tool call', () => {
    it('returns the first completion text unchanged when output is a plain goal JSON', async () => {
        const goalText = '{"goal":{"description":"chop logs","steps":["go to tree","chop"]}}';
        const client = mockLlm([{ text: goalText }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.finalText).toBe(goalText);
        expect(result.toolCallsMade).toHaveLength(0);
        expect(result.fellBackToRag).toBe(false);
        expect(result.turns).toBe(1);
    });

    it('returns after one turn when no tools are supplied', async () => {
        const text = '{"goal":{"description":"fish"}}';
        const client = mockLlm([{ text }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [],
            toolRegistry: new Map(),
        });
        expect(result.turns).toBe(1);
        expect(result.toolCallsMade).toHaveLength(0);
    });

    it('returns after one turn for a nooped first completion', async () => {
        const client = mockLlm([{ text: '', nooped: true }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.turns).toBe(1);
        expect(result.toolCallsMade).toHaveLength(0);
        expect(result.fellBackToRag).toBe(false);
    });

    it('does not parse a tool call from plain prose', async () => {
        const prose = 'I should train Firemaking by lighting fires near the bank.';
        const client = mockLlm([{ text: prose }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.finalText).toBe(prose);
        expect(result.toolCallsMade).toHaveLength(0);
        expect(result.turns).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// runPlannerToolLoop — tool call detected and executed
// ---------------------------------------------------------------------------

describe('runPlannerToolLoop — tool call path', () => {
    const toolCallJson = '{"tool":"lookup_skill","query":"firemaking xp rates"}';
    const finalGoalJson = '{"goal":{"description":"light logs for firemaking xp","steps":["pick up logs"]}}';

    it('executes the tool and uses the follow-up completion as the final answer', async () => {
        const client = mockLlm([{ text: toolCallJson }, { text: finalGoalJson }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.finalText).toBe(finalGoalJson);
        expect(result.turns).toBe(2);
        expect(result.toolCallsMade).toHaveLength(1);
        expect(result.toolCallsMade[0].tool).toBe('lookup_skill');
        expect(result.toolCallsMade[0].query).toBe('firemaking xp rates');
        expect(result.fellBackToRag).toBe(false);
    });

    it('injects the tool result into the follow-up prompt', async () => {
        const capturedPrompts: string[] = [];
        const client: LlmClient = {
            complete: async (req: LlmRequest): Promise<LlmResponse> => {
                capturedPrompts.push(req.prompt);
                return capturedPrompts.length === 1 ? { text: toolCallJson, nooped: false } : { text: finalGoalJson, nooped: false };
            },
        } as unknown as LlmClient;

        await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });

        expect(capturedPrompts).toHaveLength(2);
        expect(capturedPrompts[1]).toContain('Tool result for lookup_skill');
        expect(capturedPrompts[1]).toContain('firemaking xp rates');
    });

    it('records executedMs on the tool call record', async () => {
        const client = mockLlm([{ text: toolCallJson }, { text: finalGoalJson }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.toolCallsMade[0].executedMs).toBeGreaterThanOrEqual(0);
    });

    it('uses a custom tool when registered', async () => {
        const customToolCallJson = '{"tool":"custom_tool","query":"some query"}';
        const registry = new Map<string, (q: string) => string>();
        registry.set('custom_tool', _q => 'custom result data');

        const customDef = { name: 'custom_tool', description: 'A custom tool.', exampleQuery: 'example' };
        const client = mockLlm([{ text: customToolCallJson }, { text: finalGoalJson }]);

        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [customDef],
            toolRegistry: registry,
        });

        expect(result.toolCallsMade[0].tool).toBe('custom_tool');
        expect(result.toolCallsMade[0].result).toBe('custom result data');
        expect(result.finalText).toBe(finalGoalJson);
    });

    it('parses tool call embedded after think blocks', async () => {
        const withThink = `<think>Let me look up firemaking.</think>\n${toolCallJson}`;
        const client = mockLlm([{ text: withThink }, { text: finalGoalJson }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.toolCallsMade).toHaveLength(1);
        expect(result.finalText).toBe(finalGoalJson);
    });
});

// ---------------------------------------------------------------------------
// runPlannerToolLoop — error / fallback paths
// ---------------------------------------------------------------------------

describe('runPlannerToolLoop — fallback paths', () => {
    const toolCallJson = '{"tool":"lookup_skill","query":"fishing"}';

    it('falls back to first text when tool execution throws', async () => {
        const registry = new Map<string, (q: string) => string>();
        registry.set('lookup_skill', _q => {
            throw new Error('lookup failed');
        });

        const client = mockLlm([{ text: toolCallJson }, { text: '{}' }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: registry,
        });
        expect(result.fellBackToRag).toBe(true);
        expect(result.finalText).toBe(toolCallJson);
        expect(result.toolCallsMade).toHaveLength(0);
        expect(result.turns).toBe(1);
    });

    it('falls back when follow-up completion is nooped', async () => {
        const client = mockLlm([{ text: toolCallJson }, { text: '', nooped: true }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.fellBackToRag).toBe(true);
        expect(result.finalText).toBe(toolCallJson);
        expect(result.toolCallsMade).toHaveLength(1);
        expect(result.turns).toBe(2);
    });

    it('falls back when the named tool is not in the registry', async () => {
        const unknownToolJson = '{"tool":"unknown_tool","query":"test"}';
        const client = mockLlm([{ text: unknownToolJson }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
        expect(result.toolCallsMade).toHaveLength(0);
        expect(result.fellBackToRag).toBe(false);
        expect(result.finalText).toBe(unknownToolJson);
        expect(result.turns).toBe(1);
    });

    it('respects maxTurns=1 and falls back without executing the follow-up', async () => {
        const finalGoalJson = '{"goal":{"description":"light fires"}}';
        const client = mockLlm([{ text: toolCallJson }, { text: finalGoalJson }]);
        const result = await runPlannerToolLoop({
            llmClient: client,
            request: baseRequest,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
            maxTurns: 1,
        });
        // Tool was detected but maxTurns prevents the follow-up
        expect(result.fellBackToRag).toBe(true);
        expect(result.turns).toBe(1);
        expect(result.toolCallsMade).toHaveLength(1);
    });

    it('PLANNER_TOOL_MAX_TURNS is 2', () => {
        expect(PLANNER_TOOL_MAX_TURNS).toBe(2);
    });
});
