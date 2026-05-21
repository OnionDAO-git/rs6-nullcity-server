import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';
import { renderPortrait, type PortraitIndex } from './portrait-template';
import type { ProgressLine, TrajectoryLine } from './schemas';
import { classifyProgressLine, classifyTrajectoryLine, type PeerInteraction, peerInteractionFromTrajectoryLine } from './significance';

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

interface LibraryIndex extends PortraitIndex {
    schemaVersion: 1;
    relationshipCounts?: Record<string, number>;
}

export class LibraryUpdater {
    private readonly now: () => Date;
    private readonly seenXpSkills = new Set<string>();
    private readonly seenPeers = new Set<string>();
    private readonly peerInteractionCounts = new Map<string, number>();
    private previousStuckSince: number | null = null;
    private recentHpDangerSince: number | null = null;

    constructor(
        private readonly residentName: string,
        private readonly root: string,
        options: LibraryUpdaterOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.writeIndex(this.readIndex());
        this.hydratePeerContext();
    }

    observeTrajectory(line: TrajectoryLine): void {
        const peerInteraction = peerInteractionFromTrajectoryLine(line);
        const result = classifyTrajectoryLine(line, {
            seenPeers: this.seenPeers,
            peerInteractionCounts: this.peerInteractionCounts,
        });
        if (peerInteraction) {
            this.recordPeerInteraction(peerInteraction);
        }
        if (result.lane !== 'story' || !result.timelineEvent) {
            return;
        }
        const index = this.readIndex();
        if (line.kind === 'legacy_event') {
            this.markLastWords(index.lives, line.tick);
        }
        this.appendTimeline({ ...result.timelineEvent, lifeIndex: index.lives, significanceReasons: result.reasons });
        if (line.kind === 'legacy_event') {
            this.applyLegacyEvent(line, index);
        } else {
            this.touchIndex(index);
        }
        this.schedulePortraitRegeneration();
    }

    observeProgress(line: ProgressLine): void {
        const result = classifyProgressLine(line, {
            seenXpSkills: this.seenXpSkills,
            previousStuckSince: this.previousStuckSince,
            recentHpDangerSince: this.recentHpDangerSince,
        });
        if (result.storyKind === 'near_death_survival') {
            this.recentHpDangerSince = null;
        } else if (dangerousHpLoss(line.reasons)) {
            this.recentHpDangerSince = line.tick;
        }
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
        this.schedulePortraitRegeneration();
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
        this.schedulePortraitRegeneration();
    }

    async regeneratePortrait(): Promise<void> {
        const rendered = renderPortrait(this.residentName, this.readIndex(), this.readTimeline());
        this.writeAtomic(this.portraitJsonPath(), `${JSON.stringify(rendered.portrait, null, 2)}\n`);
        this.writeAtomic(this.portraitMarkdownPath(), rendered.markdown);
    }

    artifactPaths(): string[] {
        return [this.timelinePath(), this.indexPath(), this.portraitJsonPath(), this.portraitMarkdownPath()];
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

    private markLastWords(lifeIndex: number, tick: number): void {
        const timeline = this.readTimeline();
        const lastSayIndex = timeline.findLastIndex(
            event => event.kind === 'say' && numberField(event, 'lifeIndex', 1) === lifeIndex && numberField(event, 'tick') <= tick,
        );
        if (lastSayIndex < 0) {
            return;
        }
        timeline[lastSayIndex] = { ...timeline[lastSayIndex], lastWords: true };
        this.writeTimeline(timeline);
    }

    private hydratePeerContext(): void {
        for (const [peerId, interactions] of Object.entries(this.readIndex().relationshipCounts || {})) {
            if (Number.isFinite(interactions)) {
                this.seenPeers.add(peerId);
                this.peerInteractionCounts.set(peerId, interactions);
            }
        }
        for (const event of this.readTimeline()) {
            if (event.kind !== 'first_peer_encounter' && event.kind !== 'relationship_repeated') {
                continue;
            }
            const peerId = stringField(event, 'peerId') || stringField(event, 'peer');
            if (!peerId) {
                continue;
            }
            this.seenPeers.add(peerId);
            this.peerInteractionCounts.set(
                peerId,
                Math.max(this.peerInteractionCounts.get(peerId) ?? 0, numberField(event, 'interactions', 1)),
            );
        }
    }

    private recordPeerInteraction(peer: PeerInteraction): void {
        this.seenPeers.add(peer.id);
        const interactions = (this.peerInteractionCounts.get(peer.id) ?? 0) + 1;
        this.peerInteractionCounts.set(peer.id, interactions);
        const index = this.readIndex();
        this.writeIndex({
            ...index,
            relationshipCounts: {
                ...(index.relationshipCounts || {}),
                [peer.id]: interactions,
            },
            updatedAt: this.now().toISOString(),
        });
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
                relationshipCounts: {},
            };
        }
        return JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as LibraryIndex;
    }

    private readTimeline(): Array<Record<string, unknown>> {
        if (!fs.existsSync(this.timelinePath())) {
            return [];
        }
        return fs
            .readFileSync(this.timelinePath(), 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
                try {
                    return [JSON.parse(line) as Record<string, unknown>];
                } catch {
                    return [];
                }
            });
    }

    private writeTimeline(events: Array<Record<string, unknown>>): void {
        const text = events.map(event => JSON.stringify(pruneUndefined(event))).join('\n');
        this.writeAtomic(this.timelinePath(), text.length > 0 ? `${text}\n` : '');
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

    private portraitJsonPath(): string {
        return path.join(this.libraryDir(), 'portrait.json');
    }

    private portraitMarkdownPath(): string {
        return path.join(this.libraryDir(), 'portrait.md');
    }

    private writeAtomic(filePath: string, text: string): void {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, text);
        fs.renameSync(tmpPath, filePath);
    }

    private schedulePortraitRegeneration(): void {
        void this.regeneratePortrait();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function dangerousHpLoss(reasons: string[]): boolean {
    return reasons.some(reason => {
        const match = /^hp:-(\d+(?:\.\d+)?)$/.exec(reason);
        return match ? Number(match[1]) >= 3 : false;
    });
}

function pruneUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
