import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';
import type { ProgressLine, TrajectoryLine } from './schemas';
import { classifyProgressLine, classifyTrajectoryLine } from './significance';

export interface PatronEvent {
    kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor';
    ts: string;
    tick: number;
    patronHandle: string;
    artifact?: string;
    note?: string;
}

export interface LibraryUpdaterOptions {
    now?: () => Date;
}

interface LibraryIndex {
    schemaVersion: 1;
    resident: string;
    createdAt: string;
    updatedAt: string;
    lives: number;
    currentState: 'living' | 'ended';
}

export class LibraryUpdater {
    private readonly now: () => Date;
    private readonly seenXpSkills = new Set<string>();
    private previousStuckSince: number | null = null;

    constructor(
        private readonly residentName: string,
        private readonly root: string,
        options: LibraryUpdaterOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.writeIndex(this.readIndex());
    }

    observeTrajectory(line: TrajectoryLine): void {
        const result = classifyTrajectoryLine(line);
        if (result.lane !== 'story' || !result.timelineEvent) {
            return;
        }
        const index = this.readIndex();
        this.appendTimeline({ ...result.timelineEvent, lifeIndex: index.lives, significanceReasons: result.reasons });
        if (line.kind === 'legacy_event') {
            this.applyLegacyEvent(line, index);
        } else {
            this.touchIndex(index);
        }
    }

    observeProgress(line: ProgressLine): void {
        const result = classifyProgressLine(line, {
            seenXpSkills: this.seenXpSkills,
            previousStuckSince: this.previousStuckSince,
        });
        if (result.lane !== 'story' || !result.timelineEvent) {
            return;
        }

        const index = this.readIndex();
        this.appendTimeline({ ...result.timelineEvent, lifeIndex: index.lives, significanceReasons: result.reasons });
        if (result.storyKind === 'first_xp' && typeof result.timelineEvent.skill === 'string') {
            this.seenXpSkills.add(result.timelineEvent.skill);
        }
        if (result.storyKind === 'stuck_detected') {
            this.previousStuckSince = line.stuckSince;
        } else if (result.storyKind === 'stuck_recovered') {
            this.previousStuckSince = null;
        }
        this.touchIndex(index);
    }

    observePatron(event: PatronEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: event.kind,
            patronHandle: event.patronHandle,
            artifact: event.artifact,
            note: event.note,
            lifeIndex: index.lives,
            significanceReasons: [`patron:${event.kind}`],
        });
        this.touchIndex(index);
    }

    private applyLegacyEvent(line: TrajectoryLine, index: LibraryIndex): void {
        const event = isRecord(line.event) ? line.event : {};
        const nextIndex: LibraryIndex = {
            ...index,
            lives: event.rebirth === true ? index.lives + 1 : index.lives,
            currentState: event.rebirth === true ? 'living' : 'ended',
            updatedAt: this.now().toISOString(),
        };
        this.writeIndex(nextIndex);
    }

    private touchIndex(index: LibraryIndex): void {
        this.writeIndex({ ...index, updatedAt: this.now().toISOString() });
    }

    private appendTimeline(event: Record<string, unknown>): void {
        fs.mkdirSync(this.libraryDir(), { recursive: true });
        fs.appendFileSync(this.timelinePath(), `${JSON.stringify(pruneUndefined(event))}\n`);
    }

    private readIndex(): LibraryIndex {
        if (!fs.existsSync(this.indexPath())) {
            const now = this.now().toISOString();
            return {
                schemaVersion: 1,
                resident: this.residentName,
                createdAt: now,
                updatedAt: now,
                lives: 1,
                currentState: 'living',
            };
        }
        return JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as LibraryIndex;
    }

    private writeIndex(index: LibraryIndex): void {
        fs.mkdirSync(this.libraryDir(), { recursive: true });
        fs.writeFileSync(this.indexPath(), `${JSON.stringify(index, null, 2)}\n`);
    }

    private libraryDir(): string {
        return path.join(this.root, 'library', residentSlug(this.residentName));
    }

    private timelinePath(): string {
        return path.join(this.libraryDir(), 'timeline.jsonl');
    }

    private indexPath(): string {
        return path.join(this.libraryDir(), 'index.json');
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pruneUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
