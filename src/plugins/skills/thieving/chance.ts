import type { ThievingReward } from './thieving-targets';

export function pickpocketSuccessChance({
    thievingLevel,
    targetLevel,
    baseChance,
    minChance,
    levelFactor,
}: {
    thievingLevel: number;
    targetLevel: number;
    baseChance: number;
    minChance: number;
    levelFactor: number;
}): number {
    const levelBonus = Math.max(0, thievingLevel - targetLevel) * levelFactor;
    return Math.max(minChance, Math.min(0.95, baseChance + levelBonus));
}

export function rollSuccess(chance: number, random: () => number = Math.random): boolean {
    return random() < chance;
}

export function selectReward(rewards: ThievingReward[], random: () => number = Math.random): ThievingReward {
    const totalWeight = rewards.reduce((total, reward) => total + (reward.weight ?? 1), 0);
    let roll = random() * totalWeight;
    for (const reward of rewards) {
        roll -= reward.weight ?? 1;
        if (roll <= 0) {
            return reward;
        }
    }
    return rewards[rewards.length - 1];
}
