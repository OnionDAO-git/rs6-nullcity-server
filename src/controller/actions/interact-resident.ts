import fs from 'fs';
import path from 'path';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { AgentAction, Perception } from '../transport/message-codecs';
import { SoulLoader } from '../soul/soul-loader';
import { loadControllerConfig } from '../config';
import { residentSlug } from '../memory/runtime-state';

export function isInteractResidentAction(action: AgentAction): boolean {
    return action.kind === 'whisper' || action.kind === 'gift' || action.kind === 'assist_skill' || action.kind === 'challenge_duel';
}

export function canInteract(state: RuntimeState, action: AgentAction, perception: Perception, soul: Soul): string[] {
    if (!isInteractResidentAction(action)) {
        return [];
    }

    const reasons: string[] = [];
    const targetId = action.kind === 'whisper' ? (action as any).to : (action as any).target;

    if (!targetId || typeof targetId !== 'string') {
        return ['Target must be a valid resident or player ID'];
    }

    // 1. Target visible and alive
    const targetActor = findTargetActor(perception, targetId);
    if (!targetActor) {
        return [`Target ${targetId} is not visible`];
    }

    // Load config to find souls and memory directories
    let soulsDir = './data/souls';
    let memoryDir = './data/memory';
    try {
        const config = loadControllerConfig();
        soulsDir = config.souls.dir;
        memoryDir = config.memory.dir;
    } catch {
        // Fallback to default relative paths in tests
    }

    const soulLoader = new SoulLoader(soulsDir);

    // Check if target is deceased
    let targetDeceased = false;
    if (targetActor.hpFraction === 0) {
        targetDeceased = true;
    } else if (targetActor.kind === 'resident' || targetActor.id.startsWith('res:')) {
        try {
            const targetStatePath = path.join(memoryDir, residentSlug(targetActor.id), 'runtime-state.json');
            if (fs.existsSync(targetStatePath)) {
                const targetState = JSON.parse(fs.readFileSync(targetStatePath, 'utf8'));
                if (targetState.deceased) {
                    targetDeceased = true;
                }
            }
        } catch {
            // Ignore load/parse errors
        }
    }

    if (targetDeceased) {
        return [`Target ${targetId} is deceased`];
    }

    // 2. Verb-specific preconditions
    if (action.kind === 'whisper') {
        const text = (action as any).text;
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            reasons.push('Whisper text cannot be empty');
        } else if (text.length > 256) {
            reasons.push('Whisper text exceeds 256 characters');
        }
    }

    if (action.kind === 'gift') {
        const quantity = (action as any).quantity;
        if (typeof quantity !== 'number' || quantity < 1) {
            reasons.push('Gift quantity must be at least 1');
        }

        const artifact = (action as any).artifact;
        if (!artifact) {
            reasons.push('Gift artifact must be specified');
        } else {
            const inventory = (perception.resident as any)?.inventory || [];
            const totalAmount = inventory.reduce((sum: number, item: any) => {
                if (item && itemMatches(item, artifact)) {
                    return sum + (item.amount ?? 1);
                }
                return sum;
            }, 0);
            if (totalAmount < quantity) {
                reasons.push(`Insufficient inventory for artifact ${artifact}: has ${totalAmount}, needs ${quantity}`);
            }
        }
    }

    if (action.kind === 'assist_skill') {
        const duration = (action as any).durationTicks;
        if (typeof duration !== 'number' || duration < 1 || duration > 10) {
            reasons.push('Assist duration must be between 1 and 10 ticks');
        }

        const skill = (action as any).skill;
        if (!skill) {
            reasons.push('Assist skill must be specified');
        } else {
            const selfSkills = (perception.resident as any)?.skills || {};
            const selfLevel = getSkillLevel(selfSkills, skill);

            let targetLevel = 1;
            if (targetActor.kind === 'resident' || targetActor.id.startsWith('res:')) {
                targetLevel = getResidentSkillLevel(memoryDir, targetActor.id, skill);
            } else if (targetActor.kind === 'player') {
                targetLevel = selfLevel - 5;
            }

            if (selfLevel < targetLevel + 5) {
                reasons.push(`Self ${skill} level (${selfLevel}) is insufficient to assist target level (${targetLevel})`);
            }
        }
    }

    if (action.kind === 'challenge_duel') {
        const selfHp = (perception.resident as any)?.hp;
        const selfHpFraction = selfHp && selfHp.max ? (selfHp.current ?? 0) / selfHp.max : 1.0;
        if (selfHpFraction <= 0.25) {
            reasons.push(`Self HP is too low for a duel (${Math.round(selfHpFraction * 100)}%)`);
        }

        if (targetActor.hpFraction !== undefined && targetActor.hpFraction <= 0.25) {
            reasons.push(`Target HP is too low for a duel (${Math.round(targetActor.hpFraction * 100)}%)`);
        }

        const selfFaction = soul.frontmatter.factionId;
        let targetFaction: string | undefined = undefined;
        if (targetActor.kind === 'resident' || targetActor.id.startsWith('res:')) {
            try {
                const targetSoul = soulLoader.load(targetActor.id);
                targetFaction = targetSoul.frontmatter.factionId;
            } catch {
                // Ignore load error
            }
        }
        if (selfFaction && targetFaction && selfFaction === targetFaction) {
            reasons.push(`Cannot duel a resident from the same faction (${selfFaction})`);
        }

        const stake = (action as any).stake;
        if (stake) {
            const artifact = stake.artifact;
            const quantity = stake.quantity;
            if (typeof quantity !== 'number' || quantity < 1) {
                reasons.push('Stake quantity must be at least 1');
            }
            if (!artifact) {
                reasons.push('Stake artifact must be specified');
            } else {
                const inventory = (perception.resident as any)?.inventory || [];
                const totalAmount = inventory.reduce((sum: number, item: any) => {
                    if (item && itemMatches(item, artifact)) {
                        return sum + (item.amount ?? 1);
                    }
                    return sum;
                }, 0);
                if (totalAmount < quantity) {
                    reasons.push(`Insufficient inventory for duel stake ${artifact}: has ${totalAmount}, needs ${quantity}`);
                }
            }
        }
    }

    return reasons;
}

// Helpers
function findTargetActor(perception: Perception, targetId: string) {
    const npcs = (perception.nearby as any)?.npcs || [];
    const players = (perception.nearby as any)?.players || [];
    const actors = [...npcs, ...players];
    const targetLower = targetId.toLowerCase();

    return actors.find((actor: any) => {
        const idLower = (actor.id || '').toLowerCase();
        const nameLower = (actor.name || '').toLowerCase();
        const keyLower = (actor.key || '').toLowerCase();

        return (
            idLower === targetLower ||
            nameLower === targetLower ||
            keyLower === targetLower ||
            idLower.replace(/^res:/, '') === targetLower.replace(/^res:/, '') ||
            idLower.replace(/^player:/, '') === targetLower.replace(/^player:/, '') ||
            idLower.replace(/^npc:/, '') === targetLower.replace(/^npc:/, '')
        );
    });
}

function itemMatches(item: any, artifactStr: string): boolean {
    if (!item) return false;
    const lowerArt = artifactStr.toLowerCase();
    const itemIdStr = String(item.itemId);
    const keyLower = (item.key || '').toLowerCase();
    return itemIdStr === lowerArt || keyLower === lowerArt || keyLower.replace(/^rs:/, '') === lowerArt.replace(/^rs:/, '');
}

function getSkillLevel(skills: any, skillName: string): number {
    if (!skills || typeof skills !== 'object') return 1;
    const skillObj = skills[skillName];
    if (!skillObj) return 1;
    if (typeof skillObj === 'number') {
        return skillObj > 120 ? xpToLevel(skillObj) : skillObj;
    }
    if (typeof skillObj.level === 'number') {
        return skillObj.level;
    }
    if (typeof skillObj.xp === 'number') {
        return xpToLevel(skillObj.xp);
    }
    if (typeof skillObj.experience === 'number') {
        return xpToLevel(skillObj.experience);
    }
    return 1;
}

function getResidentSkillLevel(memoryDir: string, resident: string, skill: string): number {
    const skillsPath = path.join(memoryDir, residentSlug(resident), 'skills.md');
    if (!fs.existsSync(skillsPath)) {
        return 1;
    }
    try {
        const content = fs.readFileSync(skillsPath, 'utf8');
        let maxLevel = 1;
        const lines = content.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const jsonStart = line.indexOf('{');
            if (jsonStart !== -1) {
                try {
                    const event = JSON.parse(line.slice(jsonStart));
                    if (event && event.kind === 'level_up' && event.skill === skill && typeof event.level === 'number') {
                        if (event.level > maxLevel) {
                            maxLevel = event.level;
                        }
                    }
                } catch {
                    // Ignore JSON parsing errors
                }
            }
        }
        return maxLevel;
    } catch {
        return 1;
    }
}

function xpToLevel(xp: number): number {
    const xpTable: number[] = [0, 0];
    let points = 0;
    for (let lvl = 1; lvl < 120; lvl++) {
        points += Math.floor(lvl + 300 * 2 ** (lvl / 7));
        xpTable.push(Math.floor(points / 4));
    }
    let level = 1;
    for (let lvl = 1; lvl < xpTable.length; lvl++) {
        if (xp >= xpTable[lvl]) {
            level = lvl;
        } else {
            break;
        }
    }
    return level;
}
