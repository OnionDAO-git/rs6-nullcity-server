import type { ConstructedRegion } from '@engine/world/map/region';
import type { Position } from '../position';
import type { Actor } from './actor';

/**
 * The definition of the metadata available on an {@link Actor}.
 *
 * You cannot guarantee that all of these properties will be present on an actor,
 * so you should always check for their existence before using them.
 *
 * @author jameskmonger
 */
export type ActorMetadata = {
    /**
     * The custom constructed map region for this actor.
     *
     * TODO (jameskmonger) Should this live on Actor rather than on {@link Player}? I don't think NPCs can have a custom map.
     */
    customMap: ConstructedRegion;

    /**
     * The actor currently being followed by this actor.
     */
    following: Actor;

    /**
     * The actor which the local actor is facing towards.
     */
    faceActor: Actor;

    /**
     * Whether a walk action has cleared the actor which the local actor is facing towards.
     *
     * TODO (jameskmonger) does this belong on this metadata?
     */
    faceActorClearedByWalking: boolean;

    /**
     * The actor's last position before teleporting.
     */
    lastPosition: Position;

    /**
     * Set to true if the actor is currently teleporting.
     */
    teleporting: boolean;

    /**
     * The actor currently engaged in combat by this actor.
     *
     * Set by `CombatTask`'s constructor and cleared by its `onStop`. Plugins
     * should NOT mutate this directly — it is the lifecycle marker the
     * retaliation / aggression scanners use to decide whether an actor is
     * already busy fighting.
     */
    combatTarget: Actor | undefined;

    /**
     * Whether the actor is currently in the death animation window.
     *
     * Set at the start of `handleDeath` to suppress re-entry / further damage
     * cascades, and cleared once the deferred respawn logic in `completeDeath`
     * finishes. This is the marker the death pipeline uses to gate the
     * drop / teleport / hp-reset phase.
     */
    dying?: boolean;

    /**
     * Active overhead prayer icon id sent in the player appearance block.
     */
    prayerHeadIcon?: number;

    /**
     * Optional combat stat modifiers consumed by the combat formula pipeline.
     *
     * Prayer owns activation/drain state; combat only reads this hook so Prayer
     * can provide effective Attack/Strength/Defence/Ranged/Magic multipliers.
     */
    combatModifiers?: unknown;
};
