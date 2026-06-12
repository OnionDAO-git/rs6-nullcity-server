import { MemoryRouter } from './memory-router';

describe('MemoryRouter durable facts', () => {
    const router = new MemoryRouter(() => '2026-05-28T19:00:00.000Z');

    it('extracts direct human requests into compact social facts', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'chat',
            from: { id: 'player:james', kind: 'player', name: 'James' },
            text: 'Hans remember that I promised Codex shrimp after fishing.',
            to: 'public',
        });

        expect(facts).toEqual([
            expect.objectContaining({
                path: 'facts/social.md',
                content: expect.stringContaining('James said: "Hans remember that I promised Codex shrimp after fishing."'),
            }),
        ]);
    });

    it('routes explicit rememberFact topic instructions into the named facts topic', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'chat',
            from: { id: 'player:codex', kind: 'player', name: 'Codex' },
            text: 'agent, durable fact: west gate passphrase is ember-vellum. Use rememberFact topic routes.',
            to: 'public',
        });

        expect(facts).toEqual([
            expect.objectContaining({
                path: 'facts/routes.md',
                content: expect.stringContaining('Codex taught: "west gate passphrase is ember-vellum."'),
            }),
        ]);
    });

    it('does not promote ambient resident status loops into durable facts', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'chat',
            from: { id: 'resident:res:hans', kind: 'resident', name: 'res:hans' },
            text: 'Still here as Hans; watching the area.',
            to: 'public',
        });

        expect(facts).toEqual([]);
    });

    it('extracts NPC dialogue into quest facts', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'dialogue_opened',
            npc: { id: 'npc:cook', kind: 'npc', name: 'Cook' },
            prompt: 'Can you bring me an egg, a bucket of milk, and a pot of flour?',
            options: ['Yes, I can help.', 'No thanks.'],
        });

        expect(facts).toEqual([
            expect.objectContaining({
                path: 'facts/quests.md',
                content: expect.stringContaining('Cook: Can you bring me an egg, a bucket of milk, and a pot of flour?'),
            }),
        ]);
    });

    it('renders patron_gift memory with AP terminology (S0a)', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'patron_gift',
            patronHandle: 'alice@onion',
            amount: 10,
        });

        expect(facts).toHaveLength(1);
        expect(facts[0].path).toBe('facts/patrons.md');
        expect(facts[0].content).toContain('Patron alice@onion gave 10 AP.');
        expect(facts[0].content).not.toContain('Shards');
    });

    it('extracts death locations into danger facts', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'died',
            attacker: {
                id: 'npc:goblin',
                kind: 'npc',
                name: 'Goblin',
                position: { x: 3238, y: 3296, level: 0 },
            },
        });

        expect(facts).toEqual([
            expect.objectContaining({
                path: 'facts/dangers.md',
                content: expect.stringContaining('Died near Goblin at 3238,3296,0'),
            }),
        ]);
    });

    it('extracts cross-resident fire lore events into durable world-event facts', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'world_event',
            loreKind: 'fire_lit',
            source: 'res:duke',
            sourcePosition: { x: 3243, y: 3209, level: 0 },
            payload: { fireObjectId: 26185 },
        });

        expect(facts).toEqual([
            expect.objectContaining({
                path: 'facts/world-events.md',
                content: expect.stringContaining('Observed res:duke lit a fire at 3243,3209,0.'),
            }),
        ]);
    });

    it('ignores malformed world events when lore kind or source is missing', () => {
        expect(
            router.routeDurableFacts('res:hans', {
                kind: 'world_event',
                payload: { text: 'something happened' },
            }),
        ).toEqual([]);
    });

    it('writes human_inbox_message to facts/humans.md', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'human_inbox_message',
            text: 'Hello Hans, how are things going?',
            from: { id: 'city-user:alice@dao', kind: 'human', name: 'Alice' },
            threadId: 'thread-1',
            messageId: 'msg-1',
        });

        expect(facts).toHaveLength(1);
        expect(facts[0].path).toBe('facts/humans.md');
        expect(facts[0].content).toContain('Alice sent: "Hello Hans, how are things going?"');
    });

    it('does not write human_inbox_message with empty text to facts/humans.md', () => {
        const facts = router.routeDurableFacts('res:hans', {
            kind: 'human_inbox_message',
            text: '',
            from: { id: 'city-user:alice@dao', kind: 'human', name: 'Alice' },
        });

        expect(facts).toHaveLength(0);
    });
});

describe('MemoryRouter event routing', () => {
    const router = new MemoryRouter(() => '2026-05-28T19:00:00.000Z');

    it('routes human_inbox_message to social/<sender>.md', () => {
        const result = router.routeEvent('res:hans', {
            kind: 'human_inbox_message',
            text: 'Can you meet me at the bank?',
            from: { id: 'city-user:james@dao', kind: 'human', name: 'James' },
            threadId: 'thread-2',
            messageId: 'msg-2',
        });

        expect(result).toBeDefined();
        expect(result!.path).toBe('social/james.md');
        expect(result!.content).toContain('human_inbox_message');
    });
});
