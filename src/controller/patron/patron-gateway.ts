import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { CurrencyLedger } from './currency-ledger';
import { produceStandingTierLetter } from './letters-producer';
import type { LettersStore } from './letters-store';
import { StandingLedger, StandingTier } from './standing-ledger';
import { ResidentRuntime } from '../resident-runtime';

export interface OfferToResidentRequest {
    humanId: string;
    residentName: string;
    amount: number; // Shards units to spend
    interactionContext?: string; // free-form 'chathead', 'embassy', 'scroll'
}

export interface SponsorBirthRequest {
    humanId: string;
    factionId: string; // K-defined
    name: string; // proposed resident name
    soulFields?: {
        goals?: string;
        alignment?: string;
        quirks?: string;
        aesthetic?: string;
    };
    cost: number; // must equal sum of three ritual parts
}

export interface PatronEventOutcome {
    ok: boolean;
    eventId: string;
    standingDelta?: { factionId: string; before: number; after: number; tierCrossed?: StandingTier };
    error?: 'insufficient_currency' | 'cooldown_active' | 'resident_not_found' | 'invalid_amount';
}

export interface PatronGatewayOptions {
    currencyLedger: CurrencyLedger;
    standingLedger: StandingLedger;
    runtimes: Map<string, ResidentRuntime>;
    soulsDir?: string;
    /**
     * Optional inbox dispatcher. When present, every verb that crosses a
     * standing tier (J-α-2 StandingLedger.recordSupport returns tierCrossed)
     * also produces a {@link Letter} via {@link produceStandingTierLetter}
     * and appends it to the recipient's inbox. Letters whose tier is the
     * `stranger` sentinel are skipped (per `isUserFacingTier`).
     */
    lettersStore?: LettersStore;
    onResidentBorn?: (name: string) => void | Promise<void>;
    now?: () => Date;
}

export class PatronGateway {
    private readonly lastBirthByHuman = new Map<string, number>();

    constructor(private readonly options: PatronGatewayOptions) {}

    async offerTo(req: OfferToResidentRequest): Promise<PatronEventOutcome> {
        if (!req.humanId || !req.residentName || req.amount <= 0 || !Number.isInteger(req.amount)) {
            return { ok: false, eventId: '', error: 'invalid_amount' };
        }

        const runtime = this.options.runtimes.get(req.residentName);
        if (!runtime) {
            return { ok: false, eventId: '', error: 'resident_not_found' };
        }

        const balance = this.options.currencyLedger.balance(req.humanId);
        if (balance < req.amount) {
            return { ok: false, eventId: '', error: 'insufficient_currency' };
        }

        const now = this.resolveTime();
        const nowString = now.toISOString();

        // 1. Debit Shards
        this.options.currencyLedger.debit(req.humanId, req.amount, {
            reason: 'mercy_infusion',
            ts: nowString,
        });

        // 2. Credit attention
        const attentionPerShard = 2;
        runtime.incrementAttention(req.amount * attentionPerShard);

        // 3. Record standing
        const faction = (runtime.getState() as any).faction || 'embassy';
        const standingResult = this.options.standingLedger.recordSupport(req.humanId, faction, req.amount, {
            reason: 'mercy_infusion',
            ts: nowString,
        });

        // 3a. Letter dispatch on tier crossing (J-δ-β-2).
        this.dispatchTierLetter({
            humanId: req.humanId,
            faction,
            residentName: req.residentName,
            tierCrossed: standingResult.tierCrossed,
            amount: req.amount,
            ts: nowString,
        });

        // 4. Emit trajectory line
        const eventId = `mercy-${req.humanId}-${req.residentName}-${now.getTime()}`;
        const evidence = runtime.getEvidence();
        if (evidence) {
            evidence.trajectory.recordPatron({
                patronKind: 'patron_gift',
                patronHandle: req.humanId,
                note: req.interactionContext || 'mercy_infusion',
            });
            evidence.library?.observePatron({
                kind: 'patron_gift',
                ts: nowString,
                tick: runtime.getState().tick,
                patronHandle: req.humanId,
                note: req.interactionContext || 'mercy_infusion',
                // E7 (intelligence-verification-log.md § E7): forward
                // amount + standingTier so the Brain's memory rendering
                // can include them instead of the literal string
                // "a gift". attentionDelta mirrors the attentionPerShard
                // multiplier used above.
                amount: req.amount,
                standingTier: standingResult.tierCrossed || undefined,
                attentionDelta: req.amount * attentionPerShard,
            });
        }

        return {
            ok: true,
            eventId,
            standingDelta: {
                factionId: faction,
                before: this.options.standingLedger.points(req.humanId, faction) - req.amount,
                after: this.options.standingLedger.points(req.humanId, faction),
                tierCrossed: standingResult.tierCrossed || undefined,
            },
        };
    }

    async sponsorBirth(req: SponsorBirthRequest): Promise<PatronEventOutcome> {
        if (!req.humanId || !req.name || req.cost <= 0) {
            return { ok: false, eventId: '', error: 'invalid_amount' };
        }

        // Validate cooldown
        const lastBirth = this.lastBirthByHuman.get(req.humanId) || 0;
        const now = this.resolveTime();
        const nowString = now.toISOString();
        if (now.getTime() - lastBirth < 24 * 60 * 60 * 1000) {
            return { ok: false, eventId: '', error: 'cooldown_active' };
        }

        // Validate balance
        const balance = this.options.currencyLedger.balance(req.humanId);
        if (balance < req.cost) {
            return { ok: false, eventId: '', error: 'insufficient_currency' };
        }

        // Write soul file
        if (this.options.soulsDir) {
            const frontmatter = {
                name: req.name,
                archetype: 'default',
                faction: req.factionId,
                goals: req.soulFields?.goals ? [req.soulFields.goals] : [],
                alignment: req.soulFields?.alignment || 'neutral',
                quirks: req.soulFields?.quirks ? [req.soulFields.quirks] : [],
                aesthetic: req.soulFields?.aesthetic || 'standard',
                attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            };
            const body = `# ${req.name}\n\nSponsored by ${req.humanId}.`;
            const slug = req.name.replace(/^res:/, '');
            const soulPath = path.join(this.options.soulsDir, `${slug}.md`);

            // Ensure parent directory exists
            fs.mkdirSync(path.dirname(soulPath), { recursive: true });
            const yamlString = yaml.dump(frontmatter);
            fs.writeFileSync(soulPath, `---\n${yamlString.trim()}\n---\n${body}`, 'utf8');
        }

        // Debit currency (3 entries of 8 Shards each totaling 24)
        const partCost = Math.floor(req.cost / 3);
        this.options.currencyLedger.debit(req.humanId, partCost, { reason: 'birth_sponsorship', ts: nowString });
        this.options.currencyLedger.debit(req.humanId, partCost, { reason: 'birth_sponsorship', ts: nowString });
        this.options.currencyLedger.debit(req.humanId, req.cost - 2 * partCost, { reason: 'birth_sponsorship', ts: nowString });

        // Record standing (+10 standing points, instantly making them an acquaintance)
        const standingResult = this.options.standingLedger.recordSupport(req.humanId, req.factionId, 10, {
            reason: 'birth_sponsorship',
            ts: nowString,
        });

        // Letter dispatch on tier crossing (J-δ-β-2). Birth always grants +10,
        // which crosses stranger→acquaintance for first-time sponsors.
        this.dispatchTierLetter({
            humanId: req.humanId,
            faction: req.factionId,
            residentName: req.name,
            tierCrossed: standingResult.tierCrossed,
            amount: 10,
            ts: nowString,
        });

        this.lastBirthByHuman.set(req.humanId, now.getTime());

        const eventId = `birth-${req.humanId}-${req.name}-${now.getTime()}`;

        // Notify callback
        if (this.options.onResidentBorn) {
            await this.options.onResidentBorn(req.name);
        }

        return {
            ok: true,
            eventId,
            standingDelta: {
                factionId: req.factionId,
                before: this.options.standingLedger.points(req.humanId, req.factionId) - 10,
                after: this.options.standingLedger.points(req.humanId, req.factionId),
                tierCrossed: standingResult.tierCrossed || undefined,
            },
        };
    }

    async witnessAt(humanId: string, landmarkId: string, residentName?: string): Promise<PatronEventOutcome> {
        const now = this.resolveTime();
        const nowString = now.toISOString();
        const eventId = `witness-${humanId}-${landmarkId}-${now.getTime()}`;

        if (residentName) {
            const runtime = this.options.runtimes.get(residentName);
            if (runtime) {
                const evidence = runtime.getEvidence();
                if (evidence) {
                    evidence.trajectory.recordPatron({
                        patronKind: 'patron_witness',
                        patronHandle: humanId,
                        artifact: landmarkId,
                    });
                    evidence.library?.observePatron({
                        kind: 'patron_witness',
                        ts: nowString,
                        tick: runtime.getState().tick,
                        patronHandle: humanId,
                        artifact: landmarkId,
                    });
                }
            }
        }

        return { ok: true, eventId };
    }

    async sendGift(humanId: string, residentName: string, artifact: string): Promise<PatronEventOutcome> {
        if (!humanId || !residentName || !artifact) {
            return { ok: false, eventId: '', error: 'resident_not_found' };
        }

        const runtime = this.options.runtimes.get(residentName);
        if (!runtime) {
            return { ok: false, eventId: '', error: 'resident_not_found' };
        }

        const now = this.resolveTime();
        const nowString = now.toISOString();
        const eventId = `gift-${humanId}-${residentName}-${now.getTime()}`;

        const evidence = runtime.getEvidence();
        if (evidence) {
            evidence.trajectory.recordPatron({
                patronKind: 'patron_gift',
                patronHandle: humanId,
                artifact,
            });
            evidence.library?.observePatron({
                kind: 'patron_gift',
                ts: nowString,
                tick: runtime.getState().tick,
                patronHandle: humanId,
                artifact,
            });
        }

        return { ok: true, eventId };
    }

    private resolveTime(): Date {
        return this.options.now ? this.options.now() : new Date();
    }

    /**
     * Produce + append a standing-tier letter for a verb that returned a
     * tierCrossed outcome. No-op when lettersStore is not configured or when
     * no threshold was crossed; produceStandingTierLetter additionally
     * returns null for the `stranger` sentinel so that path is also covered.
     */
    private dispatchTierLetter(input: {
        humanId: string;
        faction: string;
        residentName: string;
        tierCrossed: StandingTier | null;
        amount: number;
        ts: string;
    }): void {
        if (!this.options.lettersStore || !input.tierCrossed) {
            return;
        }
        const letter = produceStandingTierLetter({
            humanId: input.humanId,
            faction: input.faction,
            residentName: input.residentName,
            tierCrossed: input.tierCrossed,
            amount: input.amount,
            ts: input.ts,
        });
        if (letter) {
            this.options.lettersStore.append(letter);
        }
    }
}
