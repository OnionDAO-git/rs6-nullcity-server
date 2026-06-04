export interface RoutedMemoryWrite {
    path: string;
    content: string;
}

export class MemoryRouter {
    constructor(private readonly now: () => string = () => new Date().toISOString()) {}

    routeEvent(resident: string, event: unknown): RoutedMemoryWrite | undefined {
        if (!isRecord(event)) {
            return undefined;
        }

        const timestamp = this.now();
        const kind = typeof event.kind === 'string' ? event.kind : 'event';
        const eventLine = `- ${timestamp} ${JSON.stringify(event)}\n`;

        if ((kind === 'chat' || kind === 'human_inbox_message') && isRecord(event.from)) {
            return {
                path: `social/${slug(String(event.from.name || event.from.id || 'unknown'))}.md`,
                content: eventLine,
            };
        }

        if ((kind === 'hit_taken' || kind === 'hit_dealt' || kind === 'died') && isRecord(event.from || event.to || event.attacker)) {
            const actor = (event.from || event.to || event.attacker) as Record<string, unknown>;
            return {
                path: `monsters/${slug(String(actor.name || actor.key || actor.id || 'unknown'))}.md`,
                content: eventLine,
            };
        }

        if (kind === 'level_up') {
            return {
                path: 'skills.md',
                content: eventLine,
            };
        }

        return {
            path: `events/${timestamp.slice(0, 10)}.md`,
            content: `- ${resident} ${eventLine.slice(2)}`,
        };
    }

    routeDurableFacts(_resident: string, event: unknown): RoutedMemoryWrite[] {
        if (!isRecord(event)) {
            return [];
        }

        const timestamp = this.now();
        const kind = typeof event.kind === 'string' ? event.kind : 'event';
        const writes: RoutedMemoryWrite[] = [];

        if ((kind === 'chat' || kind === 'whisper') && typeof event.text === 'string') {
            const text = cleanText(event.text);
            const explicit = explicitRememberFact(text);
            if (explicit && !isAmbientStatus(text)) {
                writes.push({
                    path: `facts/${explicit.topic}.md`,
                    content: `- ${timestamp} ${actorDisplay(event.from)} taught: "${explicit.fact}"\n`,
                });
            } else if (isDurableChat(text) && !isAmbientStatus(text)) {
                writes.push({
                    path: 'facts/social.md',
                    content: `- ${timestamp} ${actorDisplay(event.from)} said: "${text}"\n`,
                });
            }
        }

        if (kind === 'dialogue_opened' || kind === 'dialogue_updated') {
            const prompt = typeof event.prompt === 'string' ? cleanText(event.prompt) : '';
            const options = Array.isArray(event.options)
                ? event.options
                      .filter(option => typeof option === 'string')
                      .map(option => cleanText(option as string))
                      .filter(Boolean)
                : [];
            if (prompt || options.length > 0) {
                const optionText = options.length > 0 ? ` Options: ${options.join(' | ')}` : '';
                writes.push({
                    path: 'facts/quests.md',
                    content: `- ${timestamp} ${actorDisplay(event.npc)}: ${prompt || '(dialogue updated)'}${optionText}\n`,
                });
            }
        }

        if (kind === 'died') {
            const actor = firstRecord(event.attacker, event.from, event.to);
            const position = positionText(firstRecord(event.position, actor?.position));
            writes.push({
                path: 'facts/dangers.md',
                content: `- ${timestamp} Died near ${actorDisplay(actor)}${position ? ` at ${position}` : ''}; avoid or flee earlier next time.\n`,
            });
        }

        if (kind === 'level_up' && typeof event.skill === 'string') {
            const level = typeof event.level === 'number' ? ` level ${event.level}` : '';
            writes.push({
                path: 'facts/skills.md',
                content: `- ${timestamp} Reached ${event.skill}${level}.\n`,
            });
        }

        if (isPatronKind(kind)) {
            writes.push({
                path: 'facts/patrons.md',
                content: `- ${timestamp} ${renderPatronFact(event)}\n`,
            });
        }

        if (kind === 'world_event') {
            const fact = renderWorldEventFact(event);
            if (fact) {
                writes.push({
                    path: 'facts/world-events.md',
                    content: `- ${timestamp} ${fact}\n`,
                });
            }
        }

        if (kind === 'human_inbox_message' && typeof event.text === 'string') {
            const text = cleanText(event.text);
            if (text) {
                writes.push({
                    path: 'facts/humans.md',
                    content: `- ${timestamp} ${actorDisplay(event.from)} sent: "${text}"\n`,
                });
            }
        }

        return writes;
    }
}

function slug(value: string): string {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-|-$/g, '') || 'unknown'
    );
}

function cleanText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 260);
}

function isAmbientStatus(text: string): boolean {
    return /^still here as\b/i.test(text) || /^still here\b/i.test(text) || /\bwatching the area\b/i.test(text);
}

function isDurableChat(text: string): boolean {
    return (
        /@[a-z0-9._-]+/i.test(text) ||
        /\b(remember|promise|promised|asked|told|need|needs|bring|find|give|meet|kill|avoid|where|bank|quest|shard|sponsor|patron|help|later)\b/i.test(
            text,
        )
    );
}

function explicitRememberFact(text: string): { topic: string; fact: string } | undefined {
    if (!/\brememberfact\b/i.test(text) && !/\bdurable fact\b/i.test(text)) {
        return undefined;
    }
    const topic = safeTopic((text.match(/\b(?:rememberfact\s+topic|topic)\s+([a-z0-9_-]+)/i) || [])[1] || 'social');
    const durableFact = text.match(/\bdurable fact:\s*(.+?)(?:\s+use\s+rememberfact\b|$)/i)?.[1];
    const fact = cleanFact(durableFact || text.replace(/\buse\s+rememberfact\b.*$/i, '').replace(/^agent[:,]?\s*/i, ''));
    if (!topic || !fact) {
        return undefined;
    }
    return { topic, fact };
}

function safeTopic(value: string): string {
    return slug(value).replace(/_/g, '-').slice(0, 48) || 'social';
}

function cleanFact(value: string): string {
    const fact = cleanText(value)
        .replace(/^durable fact:\s*/i, '')
        .replace(/[;,\s]+$/g, '')
        .trim();
    return fact && !/[.!?]$/.test(fact) ? `${fact}.` : fact;
}

function actorDisplay(value: unknown): string {
    if (!isRecord(value)) {
        return 'Unknown';
    }
    return String(value.name || value.key || value.id || 'Unknown');
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
    return values.find(isRecord);
}

function positionText(value: unknown): string | undefined {
    if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        return undefined;
    }
    const level = typeof value.level === 'number' ? value.level : 0;
    return `${value.x},${value.y},${level}`;
}

function isPatronKind(kind: string): boolean {
    return kind === 'patron_gift' || kind === 'patron_witness' || kind === 'patron_sponsor' || kind === 'patron_ask';
}

function renderPatronFact(event: Record<string, unknown>): string {
    const handle = typeof event.patronHandle === 'string' ? event.patronHandle : 'an unknown patron';
    if (event.kind === 'patron_ask') {
        const question = typeof event.question === 'string' ? cleanText(event.question) : '(question unavailable)';
        return `Patron ${handle} asked: "${question}"`;
    }
    if (event.kind === 'patron_gift') {
        const amount = typeof event.amount === 'number' ? `${event.amount} AP` : undefined;
        const artifact = typeof event.artifact === 'string' ? event.artifact : undefined;
        const gift = amount || artifact || 'a gift';
        return `Patron ${handle} gave ${gift}.`;
    }
    if (event.kind === 'patron_witness') {
        const place = typeof event.artifact === 'string' ? ` at ${event.artifact}` : '';
        return `Patron ${handle} witnessed this resident${place}.`;
    }
    return `Patron ${handle} sponsored this resident.`;
}

function renderWorldEventFact(event: Record<string, unknown>): string | undefined {
    const loreKind = typeof event.loreKind === 'string' ? cleanText(event.loreKind) : '';
    const source = typeof event.source === 'string' ? cleanText(event.source) : '';
    if (!loreKind || !source) {
        return undefined;
    }

    const sourcePosition = firstRecord(event.sourcePosition);
    const position = positionText(sourcePosition);
    const payload = firstRecord(event.payload);
    const payloadText = payload && typeof payload.text === 'string' ? cleanText(payload.text) : undefined;

    if (loreKind === 'fire_lit') {
        return `Observed ${source} lit a fire${position ? ` at ${position}` : ''}.`;
    }

    const detail = payloadText ? `: "${payloadText}"` : '';
    return `Observed world event ${loreKind} from ${source}${position ? ` at ${position}` : ''}${detail}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
