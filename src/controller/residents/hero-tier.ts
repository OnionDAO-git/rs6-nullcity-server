import type { HeroTier } from '../soul/soul-schema';

export type ResidentTier = HeroTier;

export interface HeroTierConfig {
    tier: ResidentTier;
    initialAttention: number;
    lifespanTicks: number;
    canRequestAttention: boolean;
    canPrepareEpitaph: boolean;
    canTradeResource: boolean;
    canGatherAtLandmarks: boolean;
}

export const HERO_TIERS: Readonly<Record<ResidentTier, HeroTierConfig>> = {
    hero: {
        tier: 'hero',
        initialAttention: 100,
        lifespanTicks: 8640,
        canRequestAttention: true,
        canPrepareEpitaph: true,
        canTradeResource: true,
        canGatherAtLandmarks: true,
    },
    novice: {
        tier: 'novice',
        initialAttention: 24,
        lifespanTicks: 288,
        canRequestAttention: true,
        canPrepareEpitaph: true,
        canTradeResource: true,
        canGatherAtLandmarks: false,
    },
    background: {
        tier: 'background',
        initialAttention: 50,
        lifespanTicks: 2880,
        canRequestAttention: false,
        canPrepareEpitaph: false,
        canTradeResource: false,
        canGatherAtLandmarks: false,
    },
} as const;
