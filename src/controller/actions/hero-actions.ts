import type { RuntimeState } from '../memory/runtime-state';
import type { HeroTierConfig } from '../residents/hero-tier';

export function canRequestAttention(state: RuntimeState, tier: HeroTierConfig): boolean {
    return tier.canRequestAttention;
}

export function canPrepareEpitaph(state: RuntimeState, tier: HeroTierConfig): boolean {
    return tier.canPrepareEpitaph;
}

export function canTradeResource(
    state: RuntimeState,
    tier: HeroTierConfig,
    inventory: ReadonlyArray<{ itemId: number; amount: number; key?: string } | null>,
    artifact: string,
    quantity: number,
    targetVisible: boolean,
): { ok: boolean; reason?: string } {
    if (!tier.canTradeResource) {
        return { ok: false, reason: `Tier '${tier.tier}' does not permit trade_resource` };
    }

    // Check inventory
    let total = 0;
    for (const item of inventory) {
        if (item && itemMatches(item, artifact)) {
            total += item.amount;
        }
    }
    if (total < quantity) {
        return { ok: false, reason: 'insufficient_inventory' };
    }

    if (!targetVisible) {
        return { ok: false, reason: 'target_not_visible' };
    }

    return { ok: true };
}

export function itemMatches(item: { itemId: number; key?: string }, artifactStr: string): boolean {
    const lowerArt = artifactStr.toLowerCase();
    const itemIdStr = String(item.itemId);
    const keyLower = (item.key || '').toLowerCase();
    return itemIdStr === lowerArt || keyLower === lowerArt || keyLower.replace(/^rs:/, '') === lowerArt.replace(/^rs:/, '');
}
