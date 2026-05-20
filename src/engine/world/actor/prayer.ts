import { widgets } from '@engine/config/config-handler';
import type { Actor } from '@engine/world/actor/actor';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { soundIds } from '@engine/world/config/sound-ids';
import { isPlayer } from './util';

export type PrayerId =
    | 'thick_skin'
    | 'burst_of_strength'
    | 'clarity_of_thought'
    | 'sharp_eye'
    | 'mystic_will'
    | 'rock_skin'
    | 'superhuman_strength'
    | 'improved_reflexes'
    | 'rapid_restore'
    | 'rapid_heal'
    | 'protect_item'
    | 'hawk_eye'
    | 'mystic_lore'
    | 'steel_skin'
    | 'ultimate_strength'
    | 'incredible_reflexes'
    | 'protect_from_magic'
    | 'protect_from_missiles'
    | 'protect_from_melee'
    | 'eagle_eye'
    | 'mystic_might'
    | 'retribution'
    | 'redemption'
    | 'smite'
    | 'chivalry'
    | 'piety';

export type PrayerGroup = 'attack' | 'strength' | 'defence' | 'ranged' | 'magic' | 'overhead' | 'death';

export interface PrayerDefinition {
    id: PrayerId;
    name: string;
    level: number;
    buttonId: number;
    configBit: number;
    drain: number;
    groups: PrayerGroup[];
    soundId: number;
    headIcon?: number;
    modifiers?: Partial<Record<'attack' | 'strength' | 'defence' | 'ranged' | 'magic', number>>;
}

export const PRAYER_WIDGET_ID = widgets.prayerTab;
export const PRAYER_CONFIG_ID = 83;
export const PRAYER_RECHARGE_ALTARS = [61, 409, 410, 411, 412, 8749, 10638, 13179];

const s = soundIds.prayer;

export const PRAYERS: PrayerDefinition[] = [
    {
        id: 'thick_skin',
        name: 'Thick Skin',
        level: 1,
        buttonId: 8,
        configBit: 0,
        drain: 3,
        groups: ['defence'],
        soundId: s.thick_skin,
        modifiers: { defence: 0.05 },
    },
    {
        id: 'burst_of_strength',
        name: 'Burst of Strength',
        level: 4,
        buttonId: 9,
        configBit: 1,
        drain: 3,
        groups: ['strength'],
        soundId: s.burst_of_strength,
        modifiers: { strength: 0.05 },
    },
    {
        id: 'clarity_of_thought',
        name: 'Clarity of Thought',
        level: 7,
        buttonId: 10,
        configBit: 2,
        drain: 3,
        groups: ['attack'],
        soundId: s.clarity_of_thought,
        modifiers: { attack: 0.05 },
    },
    {
        id: 'sharp_eye',
        name: 'Sharp Eye',
        level: 8,
        buttonId: 11,
        configBit: 3,
        drain: 3,
        groups: ['ranged'],
        soundId: s.sharp_eye,
        modifiers: { ranged: 0.05 },
    },
    {
        id: 'mystic_will',
        name: 'Mystic Will',
        level: 9,
        buttonId: 12,
        configBit: 4,
        drain: 3,
        groups: ['magic'],
        soundId: s.mystic_will,
        modifiers: { magic: 0.05 },
    },
    {
        id: 'rock_skin',
        name: 'Rock Skin',
        level: 10,
        buttonId: 13,
        configBit: 5,
        drain: 6,
        groups: ['defence'],
        soundId: s.rock_skin,
        modifiers: { defence: 0.1 },
    },
    {
        id: 'superhuman_strength',
        name: 'Superhuman Strength',
        level: 13,
        buttonId: 14,
        configBit: 6,
        drain: 6,
        groups: ['strength'],
        soundId: s.superhuman_strength,
        modifiers: { strength: 0.1 },
    },
    {
        id: 'improved_reflexes',
        name: 'Improved Reflexes',
        level: 16,
        buttonId: 15,
        configBit: 7,
        drain: 6,
        groups: ['attack'],
        soundId: s.improved_reflexes,
        modifiers: { attack: 0.1 },
    },
    { id: 'rapid_restore', name: 'Rapid Restore', level: 19, buttonId: 16, configBit: 8, drain: 1, groups: [], soundId: s.rapid_restore },
    { id: 'rapid_heal', name: 'Rapid Heal', level: 22, buttonId: 17, configBit: 9, drain: 2, groups: [], soundId: s.rapid_heal },
    { id: 'protect_item', name: 'Protect Item', level: 25, buttonId: 18, configBit: 10, drain: 2, groups: [], soundId: s.prot_item },
    {
        id: 'hawk_eye',
        name: 'Hawk Eye',
        level: 26,
        buttonId: 19,
        configBit: 11,
        drain: 6,
        groups: ['ranged'],
        soundId: s.hawk_eye,
        modifiers: { ranged: 0.1 },
    },
    {
        id: 'mystic_lore',
        name: 'Mystic Lore',
        level: 27,
        buttonId: 20,
        configBit: 12,
        drain: 6,
        groups: ['magic'],
        soundId: s.mystic_lore,
        modifiers: { magic: 0.1 },
    },
    {
        id: 'steel_skin',
        name: 'Steel Skin',
        level: 28,
        buttonId: 21,
        configBit: 13,
        drain: 12,
        groups: ['defence'],
        soundId: s.steel_skin,
        modifiers: { defence: 0.15 },
    },
    {
        id: 'ultimate_strength',
        name: 'Ultimate Strength',
        level: 31,
        buttonId: 22,
        configBit: 14,
        drain: 12,
        groups: ['strength'],
        soundId: s.ultimate_strength,
        modifiers: { strength: 0.15 },
    },
    {
        id: 'incredible_reflexes',
        name: 'Incredible Reflexes',
        level: 34,
        buttonId: 23,
        configBit: 15,
        drain: 12,
        groups: ['attack'],
        soundId: s.incred_reflexes,
        modifiers: { attack: 0.15 },
    },
    {
        id: 'protect_from_magic',
        name: 'Protect from Magic',
        level: 37,
        buttonId: 24,
        configBit: 16,
        drain: 12,
        groups: ['overhead'],
        soundId: s.prot_from_mage,
        headIcon: 2,
    },
    {
        id: 'protect_from_missiles',
        name: 'Protect from Missiles',
        level: 40,
        buttonId: 25,
        configBit: 17,
        drain: 12,
        groups: ['overhead'],
        soundId: s.prot_from_ranged,
        headIcon: 1,
    },
    {
        id: 'protect_from_melee',
        name: 'Protect from Melee',
        level: 43,
        buttonId: 26,
        configBit: 18,
        drain: 12,
        groups: ['overhead'],
        soundId: s.prot_from_melee,
        headIcon: 0,
    },
    {
        id: 'eagle_eye',
        name: 'Eagle Eye',
        level: 44,
        buttonId: 27,
        configBit: 19,
        drain: 12,
        groups: ['ranged'],
        soundId: s.eagle_eye,
        modifiers: { ranged: 0.15 },
    },
    {
        id: 'mystic_might',
        name: 'Mystic Might',
        level: 45,
        buttonId: 28,
        configBit: 20,
        drain: 12,
        groups: ['magic'],
        soundId: s.mystic_might,
        modifiers: { magic: 0.15 },
    },
    {
        id: 'retribution',
        name: 'Retribution',
        level: 46,
        buttonId: 29,
        configBit: 21,
        drain: 3,
        groups: ['overhead', 'death'],
        soundId: s.retribution,
        headIcon: 3,
    },
    {
        id: 'redemption',
        name: 'Redemption',
        level: 49,
        buttonId: 30,
        configBit: 22,
        drain: 6,
        groups: ['overhead', 'death'],
        soundId: s.redemption,
        headIcon: 5,
    },
    {
        id: 'smite',
        name: 'Smite',
        level: 52,
        buttonId: 31,
        configBit: 23,
        drain: 18,
        groups: ['overhead', 'death'],
        soundId: s.smite,
        headIcon: 4,
    },
    {
        id: 'chivalry',
        name: 'Chivalry',
        level: 60,
        buttonId: 32,
        configBit: 24,
        drain: 24,
        groups: ['attack', 'strength', 'defence'],
        soundId: s.chivalry,
        modifiers: { attack: 0.15, strength: 0.18, defence: 0.2 },
    },
    {
        id: 'piety',
        name: 'Piety',
        level: 70,
        buttonId: 33,
        configBit: 25,
        drain: 24,
        groups: ['attack', 'strength', 'defence'],
        soundId: s.piety,
        modifiers: { attack: 0.2, strength: 0.23, defence: 0.25 },
    },
];

export const PRAYERS_BY_BUTTON = new Map(PRAYERS.map(prayer => [prayer.buttonId, prayer]));
export const PRAYERS_BY_ID = new Map(PRAYERS.map(prayer => [prayer.id, prayer]));

export class PrayerState {
    public readonly active = new Set<PrayerId>();
    private drainAccumulator = 0;

    public constructor(private readonly player: Player) {
        this.ensurePrayerPoints();
        this.syncConfig();
    }

    public get points(): number {
        return this.player.skills.getLevel(Skill.PRAYER);
    }

    public set points(value: number) {
        const prayer = this.player.skills.get(Skill.PRAYER);
        prayer.modifiedLevel = Math.max(0, Math.min(this.player.skills.getMaxLevel(Skill.PRAYER), Math.floor(value)));
        this.player.outgoingPackets.updateSkill(Skill.PRAYER, prayer.modifiedLevel, prayer.exp);
    }

    public toggle(definition: PrayerDefinition): void {
        if (this.active.has(definition.id)) {
            this.deactivate(definition, true);
            return;
        }
        this.activate(definition);
    }

    public activate(definition: PrayerDefinition): boolean {
        if (!this.player.skills.hasLevel(Skill.PRAYER, definition.level, true)) {
            this.player.sendMessage(`You need a Prayer level of ${definition.level} to use ${definition.name}.`);
            return false;
        }
        if (this.points <= 0) {
            this.player.sendMessage('You have run out of Prayer points; you need to recharge at an altar.');
            return false;
        }

        for (const activeId of [...this.active]) {
            const active = PRAYERS_BY_ID.get(activeId);
            if (!active) {
                continue;
            }
            if (definition.groups.some(group => active.groups.includes(group))) {
                this.deactivate(active, false);
            }
        }

        this.active.add(definition.id);
        this.syncConfig();
        this.syncHeadIcon();
        this.player.playSound(definition.soundId);
        return true;
    }

    public deactivate(definition: PrayerDefinition, playSound: boolean): void {
        if (!this.active.delete(definition.id)) {
            return;
        }
        this.syncConfig();
        this.syncHeadIcon();
        if (playSound) {
            this.player.playSound(soundIds.prayer.deactivated);
        }
    }

    public deactivateAll(playSound: boolean = false): void {
        if (this.active.size === 0) {
            return;
        }
        this.active.clear();
        this.drainAccumulator = 0;
        this.syncConfig();
        this.syncHeadIcon();
        if (playSound) {
            this.player.playSound(soundIds.prayer.deactivated);
        }
    }

    public restore(): void {
        this.points = this.player.skills.getMaxLevel(Skill.PRAYER);
        this.player.sendMessage('You recharge your Prayer points.');
    }

    public tickDrain(): void {
        if (this.active.size === 0 || this.points <= 0) {
            return;
        }
        let drain = 0;
        for (const id of this.active) {
            drain += PRAYERS_BY_ID.get(id)?.drain ?? 0;
        }
        this.drainAccumulator += drain;
        const pointsToDrain = Math.floor(this.drainAccumulator / 60);
        if (pointsToDrain <= 0) {
            return;
        }
        this.drainAccumulator -= pointsToDrain * 60;
        this.points = this.points - pointsToDrain;
        if (this.points <= 0) {
            this.player.sendMessage('You have run out of Prayer points.');
            this.deactivateAll(true);
        }
    }

    public has(id: PrayerId): boolean {
        return this.active.has(id);
    }

    public modifier(skill: 'attack' | 'strength' | 'defence' | 'ranged' | 'magic'): number {
        let best = 0;
        for (const id of this.active) {
            best = Math.max(best, PRAYERS_BY_ID.get(id)?.modifiers?.[skill] ?? 0);
        }
        return best;
    }

    private ensurePrayerPoints(): void {
        const prayer = this.player.skills.get(Skill.PRAYER);
        if (prayer.modifiedLevel === undefined) {
            prayer.modifiedLevel = prayer.level;
        }
    }

    private syncConfig(): void {
        let config = 0;
        for (const id of this.active) {
            const definition = PRAYERS_BY_ID.get(id);
            if (definition) {
                config |= 1 << definition.configBit;
            }
        }
        this.player.outgoingPackets.updateClientConfig(PRAYER_CONFIG_ID, config);
    }

    private syncHeadIcon(): void {
        const overhead = [...this.active].map(id => PRAYERS_BY_ID.get(id)).find(definition => definition?.headIcon !== undefined);
        this.player.metadata.prayerHeadIcon = overhead?.headIcon ?? -1;
        this.player.updateFlags.appearanceUpdateRequired = true;
    }
}

export function getPrayerState(player: Player): PrayerState {
    const metadata = player.metadata as typeof player.metadata & { prayerState?: PrayerState };
    if (!metadata.prayerState) {
        metadata.prayerState = new PrayerState(player);
    }
    return metadata.prayerState;
}

export function getPrayerModifier(actor: Actor, skill: 'attack' | 'strength' | 'defence' | 'ranged' | 'magic'): number {
    if (!isPlayer(actor)) {
        return 0;
    }
    return getPrayerState(actor).modifier(skill);
}

export function hasActivePrayer(actor: Actor, id: PrayerId): boolean {
    if (!isPlayer(actor)) {
        return false;
    }
    return getPrayerState(actor).has(id);
}
