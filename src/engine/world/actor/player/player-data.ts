import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { PlayerQuest } from '@engine/config/quest-config';
import { hasValueNotNull } from '@engine/util/data';
import type { SkillValue } from '@engine/world/actor/skills';
import type { Item } from '@engine/world/items/item';
import { MusicPlayerLoopMode, MusicPlayerMode } from '@engine/world/sound/music';
import { logger } from '@runejs/common';
import type { Player } from './player';

export interface Appearance {
    gender: number;
    head: number;
    torso: number;
    arms: number;
    legs: number;
    hands: number;
    feet: number;
    facialHair: number;
    hairColor: number;
    torsoColor: number;
    legColor: number;
    feetColor: number;
    skinColor: number;
}

export class PlayerSettings {
    musicVolume: number = 0;
    musicPlayerMode: number = MusicPlayerMode.AUTO;
    musicPlayerLoopMode: number = MusicPlayerLoopMode.ENABLED;
    soundEffectVolume: number = 0;
    areaEffectVolume: number = 0;
    splitPrivateChatEnabled: boolean = false;
    twoMouseButtonsEnabled: boolean = true;
    screenBrightness: number = 2;
    chatEffectsEnabled: boolean = true;
    acceptAidEnabled: boolean = true;
    runEnabled: boolean = false;
    autoRetaliateEnabled: boolean = true;
    attackStyle: number = 0;
    bankInsertMode: number = 0;
    bankWithdrawNoteMode: number = 0;
    publicChatMode: number = 0;
    privateChatMode: number = 0;
    tradeMode: number = 0;
}

export interface PlayerSave {
    username: string;
    passwordHash: string;
    rights: number;
    position: {
        x: number;
        y: number;
        level: number;
    };
    lastLogin: {
        date: Date;
        address: string;
    };
    appearance: Appearance;
    inventory: (Item | null)[];
    bank: (Item | null)[];
    equipment: (Item | null)[];
    skills: SkillValue[];
    settings: PlayerSettings;
    savedMetadata: { [key: string]: any };
    questList: PlayerQuest[];
    musicTracks: Array<number>;
    achievements: string[];
    friendsList: string[];
    ignoreList: string[];
}

export interface ResidentAgentMetadata {
    createdAt?: string;
    lastAttachedAt?: string;
    lastDetachedAt?: string;
    lastControllerId?: string;
    [key: string]: unknown;
}

export interface ResidentSave extends PlayerSave {
    agentMetadata: ResidentAgentMetadata;
}

export interface PlayerSaveOptions {
    saveDir?: string;
}

const saveFilePath = (username: string, options?: PlayerSaveOptions): string => {
    const fileName = username.toLowerCase() + '.json';
    return join(options?.saveDir || 'data/saves', fileName);
};

export type PlayerSaveLoadResult =
    | { status: 'ok'; save: PlayerSave }
    | { status: 'missing' }
    | { status: 'empty' }
    | { status: 'corrupt'; backupPath: string; error: unknown };

export const defaultAppearance = (): Appearance => {
    return {
        gender: 0,
        head: 0,
        torso: 18,
        arms: 26,
        legs: 36,
        hands: 33,
        feet: 42,
        facialHair: 10,
        hairColor: 0,
        torsoColor: 0,
        legColor: 0,
        feetColor: 0,
        skinColor: 0,
    } as Appearance;
};

export const defaultSettings = (): PlayerSettings => {
    return new PlayerSettings();
};

export const validateSettings = (player: Player): void => {
    const existingKeys = Object.keys(player.settings);
    const newSettings = new PlayerSettings();
    const newKeys = Object.keys(newSettings);

    if (newKeys.length === existingKeys.length) {
        return;
    }

    const missingKeys = newKeys.filter(key => existingKeys.indexOf(key) === -1);
    for (const key of missingKeys) {
        player.settings[key] = newSettings[key];
    }
};

export function savePlayerData(player: Player, options?: PlayerSaveOptions): boolean {
    const filePath = saveFilePath(player.username, options);

    const playerSave: PlayerSave | ResidentSave = {
        username: player.username,
        passwordHash: player.passwordHash,
        position: {
            x: player.position.x,
            y: player.position.y,
            level: player.position.level > 3 ? 0 : player.position.level,
        },
        lastLogin: {
            date: player.loginDate,
            address: player.lastAddress,
        },
        rights: player.rights.valueOf(),
        appearance: player.appearance,
        inventory: player.inventory.items,
        bank: player.bank.items.filter(item => {
            return hasValueNotNull(item);
        }),
        equipment: player.equipment.items,
        skills: player.skills.values,
        settings: player.settings,
        savedMetadata: player.savedMetadata,
        questList: player.quests,
        musicTracks: player.musicTracks,
        achievements: player.achievements,
        friendsList: player.friendsList,
        ignoreList: player.ignoreList,
    };
    const agentMetadata = (player as Player & { agentMetadata?: ResidentAgentMetadata }).agentMetadata;
    if (agentMetadata) {
        (playerSave as ResidentSave).agentMetadata = agentMetadata;
    }

    try {
        mkdirSync(options?.saveDir || 'data/saves', { recursive: true });
        writeFileSync(filePath, JSON.stringify(playerSave, null, 4));
        return true;
    } catch (error) {
        logger.error(`Error saving player data for ${player.username}.`);
        return false;
    }
}

export function playerExists(username: string, options?: PlayerSaveOptions): boolean {
    return existsSync(saveFilePath(username, options));
}

export function loadPlayerSaveResult(username: string, options?: PlayerSaveOptions): PlayerSaveLoadResult {
    const filePath = saveFilePath(username, options);

    if (!existsSync(filePath)) {
        return { status: 'missing' };
    }

    const fileData = readFileSync(filePath, 'utf8');

    if (!fileData) {
        return { status: 'empty' };
    }

    try {
        const playerSave = JSON.parse(fileData) as PlayerSave;
        if (playerSave?.position?.level > 3) {
            playerSave.position.level = 0;
        }
        return { status: 'ok', save: playerSave };
    } catch (error) {
        const backupPath = `${filePath}.bak`;
        try {
            renameSync(filePath, backupPath);
        } catch (backupError) {
            logger.error(`ESAVE_CORRUPT: malformed player save data for ${username}; failed to quarantine save.`);
            return { status: 'corrupt', backupPath, error: backupError };
        }
        logger.error(`ESAVE_CORRUPT: malformed player save data for ${username}; quarantined to ${backupPath}.`);
        return { status: 'corrupt', backupPath, error };
    }
}

export function loadPlayerSave(username: string, options?: PlayerSaveOptions): PlayerSave | null {
    const result = loadPlayerSaveResult(username, options);
    return result.status === 'ok' ? result.save : null;
}
