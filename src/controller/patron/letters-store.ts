import fs from 'fs';
import path from 'path';
import { type Letter, letterSchema } from './letters-producer';

/** Result of an append. */
export interface LettersStoreAppendResult {
    /** True if this exact letter (recipient + kind + dispatchedAt) was already in the inbox. */
    deduped: boolean;
}

/**
 * Filesystem-backed inbox per human.
 *
 * Files: `<root>/data/letters/<recipient-slug>/inbox.jsonl`. Each line is a
 * JSON-serialised {@link Letter}. Written atomically (tmp + rename) so a
 * partial write never corrupts the inbox.
 *
 * Idempotent on append: a second append of (recipient, kind, dispatchedAt)
 * is silently dropped. This lets PatronGateway / restart loops re-emit
 * letters without producing duplicates in the human's inbox.
 *
 * Recipient handles are lowercased + non-alnum stripped to derive the
 * filesystem slug. `Alice@Onion` and `alice@onion` share an inbox.
 */
export class LettersStore {
    constructor(private readonly root: string) {}

    append(letter: Letter): LettersStoreAppendResult {
        const validated = letterSchema.parse(letter);
        const existing = this.readInbox(validated.recipient);
        const isDuplicate = existing.some(
            other =>
                other.kind === validated.kind &&
                other.dispatchedAt === validated.dispatchedAt &&
                slug(other.recipient) === slug(validated.recipient),
        );
        if (isDuplicate) {
            return { deduped: true };
        }

        const next = [...existing, validated];
        this.writeAtomic(this.inboxPath(validated.recipient), serialise(next));
        return { deduped: false };
    }

    readInbox(recipient: string): Letter[] {
        const filePath = this.inboxPath(recipient);
        if (!fs.existsSync(filePath)) {
            return [];
        }
        return fs
            .readFileSync(filePath, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
                try {
                    return [JSON.parse(line) as Letter];
                } catch {
                    return [];
                }
            });
    }

    private inboxPath(recipient: string): string {
        return path.join(this.root, 'data', 'letters', slug(recipient), 'inbox.jsonl');
    }

    private writeAtomic(filePath: string, text: string): void {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, text);
        fs.renameSync(tmpPath, filePath);
    }
}

function serialise(letters: Letter[]): string {
    return letters.map(letter => JSON.stringify(letter)).join('\n') + '\n';
}

function slug(recipient: string): string {
    return recipient
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '');
}
