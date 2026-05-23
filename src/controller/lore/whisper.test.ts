import { LoreBus, type LoreEvent } from './lore-bus';
import {
    WHISPER_LORE_KIND,
    WHISPER_DEFAULT_RADIUS_TILES,
    publishWhisper,
    type WhisperInput,
    whisperInboxFor,
} from './whisper';

function makeBus() {
    return new LoreBus({ now: () => new Date('2026-05-23T11:45:00.000Z') });
}

describe('whisper substrate (L-β)', () => {
    describe('WHISPER_LORE_KIND', () => {
        it('exposes a stable string constant', () => {
            expect(WHISPER_LORE_KIND).toBe('whisper');
        });
    });

    describe('publishWhisper', () => {
        function makeRig() {
            const bus = makeBus();
            const captured: LoreEvent[] = [];
            bus.subscribe(event => captured.push(event), { kindFilter: WHISPER_LORE_KIND });
            return { bus, captured };
        }

        const baseInput: WhisperInput = {
            from: 'res:fern',
            to: 'res:hans',
            text: 'meet me by the church door at dusk',
            position: { x: 3243, y: 3209, level: 0 },
        };

        it('publishes a whisper LoreEvent with from as source and to in payload', () => {
            const { bus, captured } = makeRig();
            publishWhisper(bus, baseInput);
            expect(captured).toHaveLength(1);
            expect(captured[0].kind).toBe('whisper');
            expect(captured[0].source).toBe('res:fern');
            expect(captured[0].payload).toEqual({
                to: 'res:hans',
                text: 'meet me by the church door at dusk',
            });
        });

        it('attaches the from-position as the visibility hint with the default radius', () => {
            const { bus, captured } = makeRig();
            publishWhisper(bus, baseInput);
            expect(captured[0].visibility).toEqual({
                sourceCoord: [3243, 3209, 0],
                radiusTiles: WHISPER_DEFAULT_RADIUS_TILES,
            });
        });

        it('honors a caller-supplied radius override', () => {
            const { bus, captured } = makeRig();
            publishWhisper(bus, { ...baseInput, radiusTiles: 4 });
            expect(captured[0].visibility?.radiusTiles).toBe(4);
        });

        it('refuses self-whisper (from === to) and returns null without publishing', () => {
            const { bus, captured } = makeRig();
            const result = publishWhisper(bus, { ...baseInput, to: 'res:fern' });
            expect(result).toBeNull();
            expect(captured).toHaveLength(0);
        });

        it('refuses empty text and returns null without publishing', () => {
            const { bus, captured } = makeRig();
            const result = publishWhisper(bus, { ...baseInput, text: '   ' });
            expect(result).toBeNull();
            expect(captured).toHaveLength(0);
        });

        it('trims surrounding whitespace from the text before publishing', () => {
            const { bus, captured } = makeRig();
            publishWhisper(bus, { ...baseInput, text: '  meet me  ' });
            expect((captured[0].payload as { text: string }).text).toBe('meet me');
        });

        it('returns the published LoreEvent so callers can chain', () => {
            const { bus } = makeRig();
            const event = publishWhisper(bus, baseInput);
            expect(event).not.toBeNull();
            expect(event?.kind).toBe('whisper');
        });
    });

    describe('whisperInboxFor', () => {
        it('collects all whispers addressed to the resident (recipient filter)', () => {
            const bus = makeBus();
            const inbox = whisperInboxFor(bus, 'res:hans');
            publishWhisper(bus, {
                from: 'res:fern',
                to: 'res:hans',
                text: 'one',
                position: { x: 3243, y: 3209, level: 0 },
            });
            publishWhisper(bus, {
                from: 'res:wise-old-man',
                to: 'res:hans',
                text: 'two',
                position: { x: 3088, y: 3253, level: 0 },
            });
            const drained = inbox.drain();
            expect(drained.map(w => w.text).sort()).toEqual(['one', 'two']);
            expect(drained.map(w => w.from).sort()).toEqual(['res:fern', 'res:wise-old-man']);
        });

        it('ignores whispers addressed to other residents', () => {
            const bus = makeBus();
            const inbox = whisperInboxFor(bus, 'res:hans');
            publishWhisper(bus, {
                from: 'res:fern',
                to: 'res:wise-old-man',
                text: 'not for hans',
                position: { x: 3243, y: 3209, level: 0 },
            });
            expect(inbox.drain()).toEqual([]);
        });

        it('drain() empties the inbox; a second drain returns []', () => {
            const bus = makeBus();
            const inbox = whisperInboxFor(bus, 'res:hans');
            publishWhisper(bus, {
                from: 'res:fern',
                to: 'res:hans',
                text: 'only-once',
                position: { x: 3243, y: 3209, level: 0 },
            });
            expect(inbox.drain()).toHaveLength(1);
            expect(inbox.drain()).toEqual([]);
        });

        it('preserves the order whispers were received (FIFO)', () => {
            const bus = makeBus();
            const inbox = whisperInboxFor(bus, 'res:hans');
            for (const text of ['a', 'b', 'c', 'd']) {
                publishWhisper(bus, {
                    from: 'res:fern',
                    to: 'res:hans',
                    text,
                    position: { x: 3243, y: 3209, level: 0 },
                });
            }
            expect(inbox.drain().map(w => w.text)).toEqual(['a', 'b', 'c', 'd']);
        });

        it('returns whispers with from/text/position fields plus the original ts', () => {
            const bus = makeBus();
            const inbox = whisperInboxFor(bus, 'res:hans');
            publishWhisper(bus, {
                from: 'res:fern',
                to: 'res:hans',
                text: 'hi',
                position: { x: 3243, y: 3209, level: 0 },
            });
            const [w] = inbox.drain();
            expect(w.from).toBe('res:fern');
            expect(w.text).toBe('hi');
            expect(w.position).toEqual({ x: 3243, y: 3209, level: 0 });
            expect(w.ts).toBe('2026-05-23T11:45:00.000Z');
        });

        it('honors proximity gating via the inbox observerCoord option', () => {
            const bus = makeBus();
            // Observer is at (3243,3209,0); whisperer is 50 tiles away with default radius 6.
            const inbox = whisperInboxFor(bus, 'res:hans', {
                observerCoord: [3243, 3209, 0],
                maxDistanceTiles: 32,
            });
            publishWhisper(bus, {
                from: 'res:fern',
                to: 'res:hans',
                text: 'too far',
                position: { x: 3293, y: 3209, level: 0 }, // ~50 tiles east
            });
            publishWhisper(bus, {
                from: 'res:wise-old-man',
                to: 'res:hans',
                text: 'next door',
                position: { x: 3245, y: 3209, level: 0 }, // 2 tiles east
            });
            const drained = inbox.drain();
            expect(drained.map(w => w.text)).toEqual(['next door']);
        });

        it('respects the unsubscribe handle returned alongside drain()', () => {
            const bus = makeBus();
            const inbox = whisperInboxFor(bus, 'res:hans');
            inbox.unsubscribe();
            publishWhisper(bus, {
                from: 'res:fern',
                to: 'res:hans',
                text: 'after unsub',
                position: { x: 3243, y: 3209, level: 0 },
            });
            expect(inbox.drain()).toEqual([]);
        });
    });
});
