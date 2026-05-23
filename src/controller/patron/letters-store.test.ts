import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Letter } from './letters-producer';
import { LettersStore } from './letters-store';

describe('LettersStore', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letters-store-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function letter(overrides: Partial<Letter> = {}): Letter {
        return {
            kind: 'standing_tier_crossed',
            recipient: 'alice@onion',
            senderResident: 'res:agent',
            subject: 'You are now Acquaintance of embassy',
            body: 'Welcome, alice@onion.',
            dispatchedAt: '2026-05-23T04:00:00.000Z',
            deliveryChannels: ['web-inbox'],
            ...overrides,
        };
    }

    describe('append + readInbox', () => {
        it('starts with an empty inbox for an unknown recipient', () => {
            const store = new LettersStore(tmpRoot);
            expect(store.readInbox('alice@onion')).toEqual([]);
        });

        it('appends a letter and reads it back', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter());
            expect(store.readInbox('alice@onion')).toHaveLength(1);
            expect(store.readInbox('alice@onion')[0].subject).toMatch(/Acquaintance/);
        });

        it('preserves multiple letters in chronological order', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter({ dispatchedAt: '2026-05-23T04:00:00.000Z', subject: 'first' }));
            store.append(letter({ dispatchedAt: '2026-05-23T04:01:00.000Z', subject: 'second' }));
            const inbox = store.readInbox('alice@onion');
            expect(inbox.map(l => l.subject)).toEqual(['first', 'second']);
        });

        it('isolates inboxes per recipient', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter({ recipient: 'alice@onion', subject: 'for alice' }));
            store.append(letter({ recipient: 'bob@onion', subject: 'for bob' }));
            expect(store.readInbox('alice@onion')[0].subject).toBe('for alice');
            expect(store.readInbox('bob@onion')[0].subject).toBe('for bob');
            expect(store.readInbox('alice@onion')).toHaveLength(1);
            expect(store.readInbox('bob@onion')).toHaveLength(1);
        });
    });

    describe('idempotency', () => {
        it('treats the same (recipient, kind, dispatchedAt) as identical and does not duplicate on second append', () => {
            const store = new LettersStore(tmpRoot);
            const l = letter();
            const first = store.append(l);
            const second = store.append(l);
            expect(first.deduped).toBe(false);
            expect(second.deduped).toBe(true);
            expect(store.readInbox('alice@onion')).toHaveLength(1);
        });

        it('allows two letters of the same kind to the same recipient if dispatchedAt differs', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter({ dispatchedAt: '2026-05-23T04:00:00.000Z' }));
            store.append(letter({ dispatchedAt: '2026-05-23T04:01:00.000Z' }));
            expect(store.readInbox('alice@onion')).toHaveLength(2);
        });

        it('allows two letters of different kinds to the same recipient at the same ts', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter({ kind: 'standing_tier_crossed' }));
            store.append(letter({ kind: 'civic_milestone' }));
            expect(store.readInbox('alice@onion')).toHaveLength(2);
        });
    });

    describe('persistence + recovery', () => {
        it('persists to data/letters/<recipient-slug>/inbox.jsonl', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter());
            const filePath = path.join(tmpRoot, 'data', 'letters', 'alice-onion', 'inbox.jsonl');
            expect(fs.existsSync(filePath)).toBe(true);
        });

        it('uses an atomic write pattern (no .tmp file remains after append)', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter());
            const dir = path.join(tmpRoot, 'data', 'letters', 'alice-onion');
            const tmpFiles = fs.readdirSync(dir).filter(name => name.endsWith('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });

        it('rehydrates inbox content after constructing a fresh store on the same root', () => {
            const first = new LettersStore(tmpRoot);
            first.append(letter({ subject: 'persisted-subject' }));

            const second = new LettersStore(tmpRoot);
            const inbox = second.readInbox('alice@onion');
            expect(inbox).toHaveLength(1);
            expect(inbox[0].subject).toBe('persisted-subject');
        });

        it('skips malformed JSONL lines on read without crashing', () => {
            const dir = path.join(tmpRoot, 'data', 'letters', 'alice-onion');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, 'inbox.jsonl'),
                [
                    JSON.stringify(letter({ subject: 'good-1' })),
                    'this is not json {',
                    JSON.stringify(letter({ subject: 'good-2', dispatchedAt: '2026-05-23T04:01:00.000Z' })),
                ].join('\n') + '\n',
            );

            const store = new LettersStore(tmpRoot);
            const inbox = store.readInbox('alice@onion');
            expect(inbox.map(l => l.subject)).toEqual(['good-1', 'good-2']);
        });
    });

    describe('slug normalisation', () => {
        it('normalises recipient handles to filesystem-safe slugs (alice@onion -> alice-onion)', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter({ recipient: 'alice@onion' }));
            expect(fs.existsSync(path.join(tmpRoot, 'data', 'letters', 'alice-onion', 'inbox.jsonl'))).toBe(true);
        });

        it('preserves case-insensitive identity (Alice@Onion and alice@onion share an inbox)', () => {
            const store = new LettersStore(tmpRoot);
            store.append(letter({ recipient: 'Alice@Onion', subject: 'mixed-case' }));
            store.append(letter({ recipient: 'alice@onion', subject: 'lower-case', dispatchedAt: '2026-05-23T04:01:00.000Z' }));
            expect(store.readInbox('alice@onion')).toHaveLength(2);
        });
    });

    describe('schema enforcement', () => {
        it('rejects letters that fail the Zod letterSchema', () => {
            const store = new LettersStore(tmpRoot);
            const bad = { ...letter(), recipient: '' };
            expect(() => store.append(bad)).toThrow();
        });
    });
});
