import { rankEventsForStorytellerPresentation } from './event-ranking';
import type { DigestEvent } from './types';

const TS = '2026-05-29T05:55:00.000Z';

function event(overrides: Partial<DigestEvent>): DigestEvent {
    return {
        ref: overrides.ref ?? 'evt',
        kind: overrides.kind ?? 'library_writeback',
        residentName: overrides.residentName ?? 'res:hans',
        ts: overrides.ts ?? TS,
        note: overrides.note ?? 'Hans said: "I can feel my attention fading near the embassy."',
        importance: overrides.importance ?? 'low',
        ...overrides,
    };
}

describe('rankEventsForStorytellerPresentation', () => {
    it('promotes tangible resident speech above generic stuck recovery', () => {
        const stuck = event({
            ref: 'stuck',
            kind: 'stuck_recovered',
            residentName: 'res:agent',
            note: 'The Steward recovered from being stuck.',
            importance: 'medium',
        });
        const speech = event({
            ref: 'speech',
            kind: 'library_writeback',
            note: 'Hans said: "I can feel my attention fading. An offering at the embassy would keep me here."',
            importance: 'low',
        });

        const ranked = rankEventsForStorytellerPresentation([stuck, speech]);

        expect(ranked.map(item => item.ref)).toEqual(['speech', 'stuck']);
    });

    it('keeps critical resident survival events above tangible speech', () => {
        const fade = event({
            ref: 'fade',
            kind: 'resident_faded',
            note: 'Alice faded after attention reached zero.',
            importance: 'critical',
        });
        const speech = event({
            ref: 'speech',
            kind: 'library_writeback',
            note: 'Hans said: "The embassy offering might keep me alive."',
            importance: 'low',
        });

        const ranked = rankEventsForStorytellerPresentation([speech, fade]);

        expect(ranked.map(item => item.ref)).toEqual(['fade', 'speech']);
    });

    it('keeps high economy and item beats above tangible speech', () => {
        const gp = event({
            ref: 'gp',
            kind: 'gp_earned',
            note: 'Bob earned 150 GP near Lumbridge.',
            importance: 'high',
        });
        const item = event({
            ref: 'item',
            kind: 'ncri_created',
            note: 'Admin minted NCRI "Lumbridge Egg" for Bob.',
            importance: 'high',
        });
        const speech = event({
            ref: 'speech',
            kind: 'library_writeback',
            note: 'Hans said: "The embassy offering might keep me alive."',
            importance: 'low',
        });

        const ranked = rankEventsForStorytellerPresentation([speech, item, gp]);

        expect(
            ranked
                .slice(0, 2)
                .map(item => item.ref)
                .sort(),
        ).toEqual(['gp', 'item']);
        expect(ranked[2].ref).toBe('speech');
    });
});
