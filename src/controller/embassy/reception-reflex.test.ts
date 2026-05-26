import { PatronRegistry } from '../patron/patron-registry';
import { EMBASSY_REGION } from './embassy';
import { evaluateReceptionGreeting, type ReceptionGreetingInput } from './reception-reflex';

function patronRegistry(handles: string[]): PatronRegistry {
    return new PatronRegistry(handles.map(handle => ({ handle, kind: 'patron_witness' as const })));
}

function makeInput(overrides: Partial<ReceptionGreetingInput> = {}): ReceptionGreetingInput {
    return {
        perception: {
            resident: { position: { x: 3243, y: 3209, level: 0 } }, // inside embassy
            events: [{ kind: 'chat', text: 'hello', from: { name: 'alice@onion' } }],
        },
        region: EMBASSY_REGION,
        residentName: 'res:hans',
        registry: patronRegistry(['alice@onion']),
        ...overrides,
    };
}

describe('evaluateReceptionGreeting (EVENT-D3)', () => {
    describe('happy path: patron chat inside embassy', () => {
        it('returns a greeting whose sayText addresses the patron by handle', () => {
            const result = evaluateReceptionGreeting(makeInput());
            expect(result).not.toBeNull();
            expect(result?.action.kind).toBe('say');
            expect(result?.action.text).toMatch(/alice@onion/);
            expect(result?.action.text).toMatch(/welcome/i);
        });

        it('includes a witness intent the runtime can fan out to PatronGateway.witnessAt', () => {
            const result = evaluateReceptionGreeting(makeInput());
            expect(result?.witness).toEqual({
                patronHandle: 'alice@onion',
                landmarkId: 'embassy',
                residentName: 'res:hans',
            });
        });

        it('addresses the patron by displayName when registry exposes one', () => {
            const registry = new PatronRegistry([{ handle: 'alice@onion', kind: 'patron_witness' }]);
            const input = makeInput({
                registry,
                displayNames: { 'alice@onion': 'Alice' },
            });
            const result = evaluateReceptionGreeting(input);
            expect(result?.action.text).toMatch(/Alice/);
            expect(result?.action.text).not.toMatch(/alice@onion/);
        });

        it('attaches a cause field to the say action for trajectory observability', () => {
            const result = evaluateReceptionGreeting(makeInput());
            expect(result?.action.cause).toBe('embassy_reception_greeting');
        });
    });

    describe('gates: must be inside embassy', () => {
        it('returns null when resident is outside the region (Varrock)', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: {
                        resident: { position: { x: 3211, y: 3424, level: 0 } },
                        events: [{ kind: 'chat', text: 'hi', from: { name: 'alice@onion' } }],
                    },
                }),
            );
            expect(result).toBeNull();
        });

        it('returns null when resident position is missing', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: { events: [{ kind: 'chat', text: 'hi', from: { name: 'alice@onion' } }] },
                }),
            );
            expect(result).toBeNull();
        });
    });

    describe('gates: must be a known patron', () => {
        it('returns null when the chatter is not in the patron registry', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: {
                        resident: { position: { x: 3243, y: 3209, level: 0 } },
                        events: [{ kind: 'chat', text: 'hi', from: { name: 'stranger@onion' } }],
                    },
                }),
            );
            expect(result).toBeNull();
        });

        it('returns null when no chat events are present', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: {
                        resident: { position: { x: 3243, y: 3209, level: 0 } },
                        events: [],
                    },
                }),
            );
            expect(result).toBeNull();
        });

        it('returns null when chat events exist but lack a from.name', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: {
                        resident: { position: { x: 3243, y: 3209, level: 0 } },
                        events: [{ kind: 'chat', text: 'hi', from: {} }],
                    },
                }),
            );
            expect(result).toBeNull();
        });

        it('returns null for synthetic patron ask chat events so the CLI fallback can answer', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: {
                        resident: { position: { x: 3243, y: 3209, level: 0 } },
                        events: [
                            {
                                kind: 'chat',
                                source: 'patron:ask',
                                text: 'Can you greet me?',
                                from: { name: 'alice@onion' },
                            },
                        ],
                    },
                }),
            );
            expect(result).toBeNull();
        });
    });

    describe('picks the most-recent patron chat when multiple are present', () => {
        it('selects the LAST patron-from chat in the events array', () => {
            const registry = patronRegistry(['alice@onion', 'bob@onion']);
            const input = makeInput({
                registry,
                perception: {
                    resident: { position: { x: 3243, y: 3209, level: 0 } },
                    events: [
                        { kind: 'chat', text: 'first', from: { name: 'alice@onion' } },
                        { kind: 'chat', text: 'second', from: { name: 'stranger@onion' } },
                        { kind: 'chat', text: 'third', from: { name: 'bob@onion' } },
                    ],
                },
            });
            const result = evaluateReceptionGreeting(input);
            expect(result?.witness.patronHandle).toBe('bob@onion');
        });
    });

    describe('defensive: malformed perception', () => {
        it('returns null when perception is null/undefined/non-object', () => {
            expect(evaluateReceptionGreeting(makeInput({ perception: null as unknown as Record<string, unknown> }))).toBeNull();
            expect(evaluateReceptionGreeting(makeInput({ perception: undefined as unknown as Record<string, unknown> }))).toBeNull();
        });

        it('returns null when events is not an array', () => {
            const result = evaluateReceptionGreeting(
                makeInput({
                    perception: {
                        resident: { position: { x: 3243, y: 3209, level: 0 } },
                        events: 'not-an-array' as unknown,
                    },
                }),
            );
            expect(result).toBeNull();
        });
    });

    describe('hero selection (which resident greets)', () => {
        it('honors the explicit residentName supplied (no faction-based routing yet)', () => {
            const result = evaluateReceptionGreeting(makeInput({ residentName: 'res:father-aereck' }));
            expect(result?.witness.residentName).toBe('res:father-aereck');
        });
    });
});
