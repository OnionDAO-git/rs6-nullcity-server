export interface RoutedMemoryWrite {
    path: string;
    content: string;
}

export class MemoryRouter {
    routeEvent(resident: string, event: unknown): RoutedMemoryWrite | undefined {
        if (!isRecord(event)) {
            return undefined;
        }

        const timestamp = new Date().toISOString();
        const kind = typeof event.kind === 'string' ? event.kind : 'event';
        const eventLine = `- ${timestamp} ${JSON.stringify(event)}\n`;

        if (kind === 'chat' && isRecord(event.from)) {
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
            path: `events/${new Date().toISOString().slice(0, 10)}.md`,
            content: `- ${resident} ${eventLine.slice(2)}`,
        };
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
