import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RuntimeState } from '../memory/runtime-state';
import { evaluateNervousRules } from './rules';
import { readNervousRulesMd } from './rules-md';

describe('readNervousRulesMd', () => {
    it('debounces memory-authored trade declines so one visible request cannot flood the gateway', () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nervous-rules-md-'));
        fs.writeFileSync(
            path.join(memoryDir, 'nervous-rules.md'),
            `# Nervous system rules

<!-- controller-nervous-rules-json
{
  "rules": [
    {
      "id": "witness-requirement-rule",
      "priority": 95,
      "condition": { "kind": "event_kind", "value": "trade_request" },
      "action": {
        "kind": "trade_decline",
        "cause": "unwitnessed transaction refused per Article 1, Clause 3 of The Ledger"
      },
      "cooldownTicks": 0,
      "interruptThinking": true,
      "suppressThinking": false,
      "source": "memory"
    }
  ],
  "retired": []
}
-->
`,
        );

        const state = stateAt(100);
        const [rule] = readNervousRulesMd(memoryDir).rules;

        expect(rule).toEqual(
            expect.objectContaining({
                id: 'witness-requirement-rule',
                cooldownTicks: expect.any(Number),
                interruptThinking: false,
            }),
        );
        expect(rule.cooldownTicks).toBeGreaterThanOrEqual(60);

        const perception = { tick: 100, events: [{ kind: 'trade_request', from: { name: 'Codex' } }] };
        const first = evaluateNervousRules([rule], state, perception);
        const second = evaluateNervousRules([rule], state, perception);

        expect(first?.action.kind).toBe('trade_decline');
        expect(second).toBeUndefined();
    });
});

function stateAt(tick: number): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}
