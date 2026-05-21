export interface PortraitIndex {
    resident: string;
    createdAt: string;
    updatedAt: string;
    lives: number;
    currentState: 'living' | 'ended';
}

export interface Portrait {
    schemaVersion: 1;
    residentName: string;
    epithet?: string;
    faction?: string;
    born: { ts: string; tick: number };
    lastUpdated: { ts: string; tick: number };
    currentState: 'living' | 'deceased' | 'reborn';
    livesCount: number;
    lives: PortraitLife[];
    voice: { quotes: PortraitQuote[] };
    relationships: PortraitRelationship[];
    patrons: PortraitPatron[];
    wants: PortraitWants;
    artifacts: string[];
    cost?: { totalUsd: number; perLife: number[] };
}

export interface PortraitLife {
    index: number;
    epithet?: string;
    bornTick: number;
    diedTick?: number;
    deathCause?: string;
    durationTicks: number;
    notableEvents: Array<{ tick: number; kind: string; summary: string }>;
    lastWords?: string;
}

export interface PortraitQuote {
    tick: number;
    text: string;
    lifeIndex: number;
    tag?: 'first' | 'last_words' | 'mentions_peer' | 'mentions_want';
}

export interface PortraitRelationship {
    peer: string;
    firstMet: { tick: number };
    interactions: number;
    lastInteraction?: { tick: number; partingBeforeDeath: boolean };
}

export interface PortraitPatron {
    handle: string;
    events: Array<{ kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor'; ts: string; artifact?: string }>;
    sentence: string;
}

export interface PortraitWants {
    current: string[];
    unfulfilledAtDeath: Array<{ lifeIndex: number; want: string }>;
}

export interface RenderedPortrait {
    portrait: Portrait;
    markdown: string;
}

export function renderPortrait(residentName: string, index: PortraitIndex, timeline: Array<Record<string, unknown>>): RenderedPortrait {
    const events = [...timeline].sort((a, b) => numberField(a, 'tick') - numberField(b, 'tick'));
    const bornEvent = events[0];
    const lastEvent = events.at(-1);
    const lives = buildLives(index, events);
    const quotes = buildQuotes(events, lives);
    const relationships = buildRelationships(events);
    const patrons = buildPatrons(events);
    const wants = buildWants(events, index.currentState === 'ended');
    const artifacts = buildArtifacts(events);
    const epithet = lives.at(-1)?.epithet || 'the Remembered Resident';
    const portrait: Portrait = {
        schemaVersion: 1,
        residentName,
        epithet,
        born: {
            ts: stringField(bornEvent, 'ts') || index.createdAt,
            tick: numberField(bornEvent, 'tick'),
        },
        lastUpdated: {
            ts: stringField(lastEvent, 'ts') || index.updatedAt,
            tick: numberField(lastEvent, 'tick'),
        },
        currentState: index.currentState === 'ended' ? 'deceased' : index.lives > 1 ? 'reborn' : 'living',
        livesCount: Math.max(index.lives, lives.length),
        lives,
        voice: { quotes },
        relationships,
        patrons,
        wants,
        artifacts,
    };
    return {
        portrait,
        markdown: renderMarkdown(portrait),
    };
}

function buildLives(index: PortraitIndex, events: Array<Record<string, unknown>>): PortraitLife[] {
    const maxLife = Math.max(index.lives, ...events.map(event => numberField(event, 'lifeIndex', 1)));
    const lives: PortraitLife[] = [];
    for (let lifeIndex = 1; lifeIndex <= maxLife; lifeIndex += 1) {
        const lifeEvents = events.filter(event => numberField(event, 'lifeIndex', 1) === lifeIndex);
        const bornTick = numberField(lifeEvents[0], 'tick');
        const legacy = lifeEvents.find(event => event.kind === 'legacy_event');
        const diedTick = legacy ? numberField(legacy, 'tick') : undefined;
        const deathCause = legacy ? deathCauseFromLegacy(legacy) : undefined;
        const lastWords = legacy ? lastQuoteBefore(lifeEvents, numberField(legacy, 'tick')) : undefined;
        const lastTick = numberField(lifeEvents.at(-1), 'tick', bornTick);
        lives.push({
            index: lifeIndex,
            epithet: lifeEpithet(lifeEvents, deathCause),
            bornTick,
            diedTick,
            deathCause,
            durationTicks: Math.max(0, (diedTick ?? lastTick) - bornTick),
            notableEvents: lifeEvents.filter(isNotable).map(event => ({
                tick: numberField(event, 'tick'),
                kind: stringField(event, 'kind') || 'event',
                summary: eventSummary(event),
            })),
            lastWords,
        });
    }
    return lives;
}

function buildQuotes(events: Array<Record<string, unknown>>, lives: PortraitLife[]): PortraitQuote[] {
    const lastWordKeys = new Set(lives.filter(life => life.lastWords).map(life => `${life.index}:${life.lastWords}`));
    return events
        .filter(event => event.kind === 'say')
        .map((event, index) => {
            const text = stringField(event, 'text') || '';
            const lifeIndex = numberField(event, 'lifeIndex', 1);
            return {
                tick: numberField(event, 'tick'),
                text,
                lifeIndex,
                tag: quoteTag(text, index, lastWordKeys.has(`${lifeIndex}:${text}`)),
            };
        })
        .slice(-12);
}

function buildPatrons(events: Array<Record<string, unknown>>): PortraitPatron[] {
    const grouped = new Map<string, PortraitPatron['events']>();
    for (const event of events) {
        if (event.kind !== 'patron_gift' && event.kind !== 'patron_witness' && event.kind !== 'patron_sponsor') {
            continue;
        }
        const handle = stringField(event, 'patronHandle') || 'anonymous';
        const patronEvents = grouped.get(handle) || [];
        patronEvents.push({
            kind: event.kind,
            ts: stringField(event, 'ts') || '',
            artifact: stringField(event, 'artifact'),
        });
        grouped.set(handle, patronEvents);
    }
    return [...grouped.entries()].map(([handle, eventsForHandle]) => ({
        handle,
        events: eventsForHandle,
        sentence: patronSentence(handle, eventsForHandle),
    }));
}

function buildRelationships(events: Array<Record<string, unknown>>): PortraitRelationship[] {
    const relationships = new Map<string, PortraitRelationship>();
    for (const event of events) {
        if (event.kind !== 'first_peer_encounter' && event.kind !== 'relationship_repeated' && event.kind !== 'relationship_parting') {
            continue;
        }
        const peer = stringField(event, 'peer') || stringField(event, 'peerId');
        if (!peer) {
            continue;
        }
        const key = stringField(event, 'peerId') || peer;
        const tick = numberField(event, 'tick');
        const existing = relationships.get(key);
        const interactions = Math.max(
            existing?.interactions ?? 0,
            numberField(event, 'interactions', existing ? existing.interactions : 1),
        );
        relationships.set(key, {
            peer,
            firstMet: existing?.firstMet ?? { tick },
            interactions,
            lastInteraction: {
                tick: Math.max(existing?.lastInteraction?.tick ?? tick, tick),
                partingBeforeDeath: event.kind === 'relationship_parting' || existing?.lastInteraction?.partingBeforeDeath === true,
            },
        });
    }
    return [...relationships.values()].sort((a, b) => a.firstMet.tick - b.firstMet.tick);
}

function buildWants(events: Array<Record<string, unknown>>, deceased: boolean): PortraitWants {
    const wants = events
        .filter(event => event.kind === 'say')
        .map(event => stringField(event, 'text') || '')
        .filter(isWantText);
    return {
        current: deceased ? [] : wants,
        unfulfilledAtDeath: deceased
            ? wants.map(want => ({
                  lifeIndex: numberField(
                      events.find(event => stringField(event, 'text') === want),
                      'lifeIndex',
                      1,
                  ),
                  want,
              }))
            : [],
    };
}

function buildArtifacts(events: Array<Record<string, unknown>>): string[] {
    const artifacts = new Set<string>();
    for (const event of events) {
        if (event.kind === 'first_xp') {
            artifacts.add(`${stringField(event, 'skill') || 'unknown'} xp`);
        }
        const artifact = stringField(event, 'artifact');
        if (artifact) {
            artifacts.add(artifact);
        }
    }
    return [...artifacts];
}

function renderMarkdown(portrait: Portrait): string {
    const lines = [
        `# ${portrait.residentName}, ${portrait.epithet || 'the Remembered Resident'}`,
        `Born tick ${portrait.born.tick}, ${portrait.born.ts}. ${portrait.livesCount} ${portrait.livesCount === 1 ? 'life' : 'lives'}. ${portrait.currentState}.`,
        '',
        '## What they wanted',
        portrait.wants.current.length > 0
            ? portrait.wants.current.map(want => `- ${want}`).join('\n')
            : portrait.wants.unfulfilledAtDeath.length > 0
              ? portrait.wants.unfulfilledAtDeath.map(want => `- ${want.want}`).join('\n')
              : 'No recorded wants.',
        '',
        '## Who they knew',
        portrait.relationships.length > 0 ? portrait.relationships.map(relationshipLine).join('\n') : 'No named relationships yet.',
        '',
        '## In their own words',
        portrait.voice.quotes.length > 0 ? portrait.voice.quotes.map(quote => `> ${quote.text}`).join('\n') : 'No recorded words.',
        '',
        ...portrait.lives.flatMap(life => renderLife(life)),
        '## Patrons',
        portrait.patrons.length > 0 ? portrait.patrons.map(patron => `- ${patron.sentence}`).join('\n') : 'No recorded patrons.',
        '',
        '## What remains',
        portrait.artifacts.length > 0 ? portrait.artifacts.map(artifact => `- ${artifact}`).join('\n') : 'No recorded artifacts yet.',
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function renderLife(life: PortraitLife): string[] {
    return [
        `## Life ${roman(life.index)} - ${life.epithet || 'The remembered life'}`,
        life.notableEvents.length > 0
            ? life.notableEvents.map(event => `${event.summary}.`).join(' ')
            : 'This life has not gathered notable events yet.',
        '',
        '### How it ended',
        life.deathCause ? `Ended at tick ${life.diedTick}: ${life.deathCause}.` : 'This life has not ended.',
        life.lastWords ? `\n> ${life.lastWords}` : '',
        '',
    ];
}

function lifeEpithet(events: Array<Record<string, unknown>>, deathCause?: string): string {
    const firstXp = events.find(event => event.kind === 'first_xp');
    if (firstXp) {
        return `The new ${stringField(firstXp, 'skill') || 'skill'} hand`;
    }
    if (deathCause) {
        return 'The unfinished life';
    }
    if (events.some(event => event.kind === 'say')) {
        return 'The speaking life';
    }
    return 'The quiet life';
}

function eventSummary(event: Record<string, unknown>): string {
    if (event.kind === 'first_xp') {
        return `First ${stringField(event, 'skill') || 'skill'} progress at tick ${numberField(event, 'tick')}`;
    }
    if (event.kind === 'stuck_detected') {
        return `Became stuck at tick ${numberField(event, 'tick')}`;
    }
    if (event.kind === 'stuck_recovered') {
        return `Recovered momentum at tick ${numberField(event, 'tick')}`;
    }
    if (event.kind === 'first_peer_encounter') {
        return `Met ${stringField(event, 'peer') || 'someone'} at tick ${numberField(event, 'tick')}`;
    }
    if (event.kind === 'relationship_repeated') {
        return `Built history with ${stringField(event, 'peer') || 'someone'} at tick ${numberField(event, 'tick')}`;
    }
    if (event.kind === 'say') {
        return `Said "${stringField(event, 'text') || ''}"`;
    }
    return `${stringField(event, 'kind') || 'event'} at tick ${numberField(event, 'tick')}`;
}

function isNotable(event: Record<string, unknown>): boolean {
    return event.kind !== 'legacy_event';
}

function lastQuoteBefore(events: Array<Record<string, unknown>>, tick: number): string | undefined {
    return [...events].reverse().find(event => event.kind === 'say' && numberField(event, 'tick') <= tick && typeof event.text === 'string')
        ?.text as string | undefined;
}

function deathCauseFromLegacy(event: Record<string, unknown>): string | undefined {
    const legacy = isRecord(event.event) ? event.event : {};
    return stringField(legacy, 'cause') || stringField(legacy, 'reason');
}

function quoteTag(text: string, index: number, lastWords: boolean): PortraitQuote['tag'] {
    if (lastWords) {
        return 'last_words';
    }
    if (isWantText(text)) {
        return 'mentions_want';
    }
    if (index === 0) {
        return 'first';
    }
    return undefined;
}

function patronSentence(handle: string, events: PortraitPatron['events']): string {
    const first = events[0];
    if (!first) {
        return `${handle} was recorded as a patron.`;
    }
    return first.artifact
        ? `${handle} recorded ${first.kind.replace('patron_', '')} with ${first.artifact}.`
        : `${handle} recorded ${first.kind.replace('patron_', '')}.`;
}

function relationshipLine(relationship: PortraitRelationship): string {
    const noun = relationship.interactions === 1 ? 'interaction' : 'interactions';
    return `- ${relationship.peer} (${relationship.interactions} ${noun})`;
}

function isWantText(text: string): boolean {
    return /\b(want|need|hope|wish|would like)\b/i.test(text);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!record) {
        return undefined;
    }
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string, fallback = 0): number {
    if (!record) {
        return fallback;
    }
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function roman(value: number): string {
    const numerals: Array<[number, string]> = [
        [10, 'X'],
        [9, 'IX'],
        [5, 'V'],
        [4, 'IV'],
        [1, 'I'],
    ];
    let remaining = value;
    let rendered = '';
    for (const [amount, symbol] of numerals) {
        while (remaining >= amount) {
            rendered += symbol;
            remaining -= amount;
        }
    }
    return rendered || String(value);
}
