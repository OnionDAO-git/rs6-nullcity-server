import { z } from 'zod';
import { type StandingTier, isUserFacingTier } from './standing-ledger';

/**
 * A letter dispatched to a human after a standing-tier crossing, a resident
 * death (J-δ-β, TODO), or a civic milestone (J-δ-γ, TODO).
 *
 * Per the OnionDAO Notion + the patron-loop spec, letters are the
 * human-visible counterpart to the resident-visible portrait timeline.
 * Standing crossings, resident deaths, and civic achievements all surface
 * here.
 */
export interface Letter {
    /** Discriminator. Only 'standing_tier_crossed' is produced in this slice. */
    kind: 'standing_tier_crossed' | 'epitaph' | 'civic_milestone';
    /** humanId (badge handle, e.g. 'alice@onion'). */
    recipient: string;
    /**
     * The resident the letter is from. Today this is the resident the human
     * supported. J-δ-3 (hero death) will sometimes set this to a SIBLING
     * resident in the same faction so a deceased hero's death-letter
     * arrives "from" a flagship who survived.
     */
    senderResident: string;
    /** Short subject line for web inbox + scroll envelope. */
    subject: string;
    /** Full prose body. No LLM yet — templated. */
    body: string;
    /** ISO timestamp of dispatch. Usually the support's ts. */
    dispatchedAt: string;
    /**
     * Where this letter should be delivered. The dispatcher (later slice)
     * fans out across channels.
     */
    deliveryChannels: Array<'web-inbox' | 'in-game-scroll' | 'lanyard-card'>;
}

export const letterSchema = z.object({
    kind: z.enum(['standing_tier_crossed', 'epitaph', 'civic_milestone']),
    recipient: z.string().min(1),
    senderResident: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    dispatchedAt: z.string().min(1),
    deliveryChannels: z.array(z.enum(['web-inbox', 'in-game-scroll', 'lanyard-card'])).min(1),
});

/** Input for {@link produceStandingTierLetter}. */
export interface StandingTierLetterInput {
    humanId: string;
    faction: string;
    residentName: string;
    /** The tier the human's standing crossed into. */
    tierCrossed: StandingTier;
    /** The support amount in Shards that produced this crossing. */
    amount: number;
    /** ISO timestamp from the supporting ledger entry. */
    ts: string;
}

/**
 * Generate a standing-tier-crossing letter, or `null` if the "crossing" was
 * into the `stranger` sentinel (which has no user-facing copy per
 * `isUserFacingTier`).
 *
 * Pure function; no I/O. The dispatcher slice (J-δ-β / J-δ-γ) handles
 * delivery + persistence.
 */
export function produceStandingTierLetter(input: StandingTierLetterInput): Letter | null {
    if (!isUserFacingTier(input.tierCrossed)) {
        return null;
    }

    // isUserFacingTier eliminates 'stranger'; narrow for the body renderer.
    const tier = input.tierCrossed as Exclude<StandingTier, 'stranger'>;
    const tierLabel = capitalize(tier);
    const subject = `You are now ${tierLabel} of ${input.faction}`;
    const body = renderTierBody({
        tier,
        humanId: input.humanId,
        faction: input.faction,
        residentName: input.residentName,
        amount: input.amount,
    });

    return {
        kind: 'standing_tier_crossed',
        recipient: input.humanId,
        senderResident: input.residentName,
        subject,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox'],
    };
}

interface TierBodyContext {
    tier: 'acquaintance' | 'ally' | 'officer';
    humanId: string;
    faction: string;
    residentName: string;
    amount: number;
}

function renderTierBody(ctx: TierBodyContext): string {
    switch (ctx.tier) {
        case 'acquaintance':
            return [
                `${ctx.humanId},`,
                '',
                `Your support of ${ctx.residentName} reached the embassy. The clerks of ${ctx.faction} have noted your name; you are now known to us as an Acquaintance.`,
                '',
                `Your most recent offering of ${ctx.amount} Shard${ctx.amount === 1 ? '' : 's'} brought you here. A small grace, and an honest one. Welcome.`,
                '',
                '— Embassy Clerk',
            ].join('\n');
        case 'ally':
            return [
                `${ctx.humanId},`,
                '',
                `You are now an Ally of ${ctx.faction}. ${ctx.residentName} remembers you in a way only steady patronage earns.`,
                '',
                `Your support of ${ctx.amount} Shard${ctx.amount === 1 ? '' : 's'} carried you past acquaintance. Allies receive the city's small favors: priority routing for letters, a hand when stuck, a name spoken back when asked.`,
                '',
                '— Embassy Clerk',
            ].join('\n');
        case 'officer':
            return [
                `${ctx.humanId},`,
                '',
                `${ctx.faction} names you Officer. This is the highest standing in our register, and it is not given lightly.`,
                '',
                `Your support of ${ctx.amount} Shard${ctx.amount === 1 ? '' : 's'} brought you across the last threshold. Officers shape what ${ctx.residentName} and their siblings can attempt — your voice carries with theirs now, in matters of city, faction, and quiet hour.`,
                '',
                '— Embassy Clerk',
            ].join('\n');
    }
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
