import { classifyActionResult } from './reporter';

describe('classifyActionResult', () => {
    it('marks unsupported actions as unimplemented bugs', () => {
        expect(classifyActionResult({ ok: false, reason: 'unsupported_spell_target' })).toEqual({
            severity: 'error',
            kind: 'unimplemented',
            reason: 'unsupported_spell_target',
        });
    });

    it('keeps empty inventory as a goal mismatch instead of a server bug', () => {
        expect(classifyActionResult({ ok: false, reason: 'empty_inventory_slot' })).toEqual({
            severity: 'info',
            kind: 'goal_mismatch',
            reason: 'empty_inventory_slot',
        });
    });
});
