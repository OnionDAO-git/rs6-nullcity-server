import { ByteBuffer } from '@runejs/common';

import { Packet, PacketType } from '@engine/net/packet';
import { activeWorld } from '@engine/world';
import type { Npc } from '@engine/world/actor/npc';
import { isPlayer } from '@engine/world/actor/util';
import type { Player } from '../player';
import { SyncTask, registerNewActors, syncTrackedActors } from './actor-sync';

/**
 * Handles the chonky npc synchronization packet for a specific player.
 */
export class NpcSyncTask extends SyncTask<void> {
    private readonly player: Player;

    public constructor(player: Player) {
        super();
        this.player = player;
    }

    public async execute(): Promise<void> {
        return new Promise<void>(resolve => {
            const npcUpdatePacket: Packet = new Packet(128, PacketType.DYNAMIC_LARGE);
            npcUpdatePacket.openBitBuffer();

            const updateMaskData = new ByteBuffer(5000);

            const nearbyNpcs = activeWorld.npcTree
                .colliding({
                    x: this.player.position.x - 15,
                    y: this.player.position.y - 15,
                    width: 32,
                    height: 32,
                })
                .filter(collision => {
                    const npc = (collision?.actor as Npc) || null;
                    return npc && npc.initialized && npc.instanceId === this.player.instance.instanceId;
                });

            this.player.trackedNpcs = syncTrackedActors(
                npcUpdatePacket,
                this.player.position,
                actor => this.appendUpdateMaskData(actor as Npc, updateMaskData),
                this.player.trackedNpcs,
                nearbyNpcs,
            ) as Npc[];

            registerNewActors(npcUpdatePacket, this.player, this.player.trackedNpcs, nearbyNpcs, actor => {
                const newNpc = actor as Npc;
                const positionOffsetX = newNpc.position.x - this.player.position.x;
                const positionOffsetY = newNpc.position.y - this.player.position.y;

                // Add npc to this player's list of tracked npcs
                this.player.trackedNpcs.push(newNpc);

                // Notify the client of the new npc and their worldIndex
                npcUpdatePacket.putBits(15, newNpc.worldIndex);
                npcUpdatePacket.putBits(3, newNpc.faceDirection);
                npcUpdatePacket.putBits(5, positionOffsetX); // World Position X axis offset relative to the player
                npcUpdatePacket.putBits(5, positionOffsetY); // World Position Y axis offset relative to the player
                npcUpdatePacket.putBits(1, newNpc.updateFlags.updateBlockRequired ? 1 : 0); // Update is required
                npcUpdatePacket.putBits(1, 1); // Discard client walking queues
                npcUpdatePacket.putBits(13, newNpc.id);

                this.appendUpdateMaskData(newNpc, updateMaskData);
            });

            if (updateMaskData.writerIndex !== 0) {
                npcUpdatePacket.putBits(15, 32767);
                npcUpdatePacket.closeBitBuffer();

                npcUpdatePacket.putBytes(updateMaskData.flipWriter());
            } else {
                // No npc updates were appended, so just end the packet here
                npcUpdatePacket.closeBitBuffer();
            }

            this.player.outgoingPackets.queue(npcUpdatePacket, true);
            resolve();
        });
    }

    /**
     * Append per-NPC update-block data the client expects, in the order the
     * client parses fields. See `Client.getNpcPosExtended` in the rs6-client-ts
     * sources for the canonical parse order and per-field byte encodings.
     *
     * HITMARK fields use the `g1_alt1` / `g1_alt3` byte transforms, so we
     * pre-transform the values before writing.
     */
    private appendUpdateMaskData(npc: Npc, updateMaskData: ByteBuffer): void {
        const updateFlags = npc.updateFlags;
        if (!updateFlags.updateBlockRequired) {
            return;
        }

        let mask = 0;

        if (updateFlags.damage !== null) {
            mask |= 0x1;
        }
        if (updateFlags.appearanceUpdateRequired) {
            mask |= 0x80;
        }
        if (updateFlags.faceActor !== null) {
            mask |= 0x4;
        }
        if (updateFlags.chatMessages.length !== 0) {
            mask |= 0x40;
        }
        if (updateFlags.facePosition !== null) {
            mask |= 0x8;
        }
        if (updateFlags.animation) {
            mask |= 0x10;
        }

        if (updateFlags.graphics) {
            mask |= 0x20;
        }

        updateMaskData.put(mask, 'BYTE');

        // Field write order MUST match client `getNpcPosExtended` parse order:
        // HITMARK (0x1), SPOTANIM (0x20), FACEENTITY (0x4), [HITMARK2 0x2 skipped],
        // SAY (0x40), CHANGETYPE (0x80), FACESQUARE (0x8), ANIM (0x10).

        if (updateFlags.damage !== null) {
            const damage = updateFlags.damage;
            // Client decodes HITMARK as:
            //   damage      = g1_alt1()  → (byte - 128) & 0xff
            //   damageType  = g1_alt3()  → (128 - byte) & 0xff
            //   health      = g1_alt1()
            //   totalHealth = g1()       → raw byte
            updateMaskData.put((damage.damageDealt + 128) & 0xff);
            updateMaskData.put((128 - damage.damageType.valueOf()) & 0xff);
            updateMaskData.put((damage.remainingHitpoints + 128) & 0xff);
            updateMaskData.put(damage.maxHitpoints & 0xff);
        }

        if (updateFlags.graphics) {
            const { id, delay = 0, height } = updateFlags.graphics;
            // SPOTANIM id read as g2_alt3() → bytes are [(high - 128), low].
            // Server must write [((high + 128) & 0xff), low].
            updateMaskData.put((((id >> 8) & 0xff) + 128) & 0xff, 'BYTE');
            updateMaskData.put(id & 0xff, 'BYTE');
            // Info int read as g4() (big-endian, no transform).
            updateMaskData.put((height << 16) | (delay & 0xffff), 'INT');
        }

        if (updateFlags.faceActor !== null) {
            const actor = updateFlags.faceActor;

            let worldIndex: number;
            if (actor === 'CLEAR') {
                // Reset faced actor — sentinel 65535 (client checks decoded == 65535).
                worldIndex = 65535;
            } else {
                worldIndex = actor.worldIndex;

                if (isPlayer(actor)) {
                    // Client checks if index is less than 32768.
                    // If it is, it looks for an NPC.
                    // If it isn't, it looks for a player (subtracting 32768 to find the index).
                    worldIndex += 32768 + 1;
                }
            }

            // FACEENTITY read as g2_alt2() → bytes are [high, (low - 128)].
            // Server writes [high, ((low + 128) & 0xff)].
            updateMaskData.put((worldIndex >> 8) & 0xff, 'BYTE');
            updateMaskData.put(((worldIndex & 0xff) + 128) & 0xff, 'BYTE');
        }

        if (updateFlags.chatMessages.length !== 0) {
            const message = updateFlags.chatMessages[0];

            // SAY read as gjstr() — terminated string. Leave putString as-is
            // (matches existing dialogue chat path).
            if (message.message) {
                updateMaskData.putString(message.message);
            } else {
                updateMaskData.putString('Undefined Message');
            }
        }

        if (updateFlags.appearanceUpdateRequired) {
            // CHANGETYPE read as g2_alt2() → same transform as FACEENTITY.
            const id = npc.id;
            updateMaskData.put((id >> 8) & 0xff, 'BYTE');
            updateMaskData.put(((id & 0xff) + 128) & 0xff, 'BYTE');
        }

        if (updateFlags.facePosition) {
            const position = updateFlags.facePosition;
            // FACESQUARE x read as g2_alt2() → same transform as FACEENTITY.
            const x = position.x * 2 + 1;
            updateMaskData.put((x >> 8) & 0xff, 'BYTE');
            updateMaskData.put(((x & 0xff) + 128) & 0xff, 'BYTE');
            // FACESQUARE z read as g2_alt1() → little-endian, no transform.
            updateMaskData.put(position.y * 2 + 1, 'SHORT', 'LITTLE_ENDIAN');
        }

        if (updateFlags.animation) {
            const animation = updateFlags.animation;

            let animId: number;
            let delay: number;
            if (animation === null || animation.id === -1) {
                // Reset animation — sentinel 65535.
                animId = 65535;
                delay = 0;
            } else {
                animId = animation.id;
                delay = animation.delay || 0;
            }

            // ANIM id read as g2_alt2() → [high, (low - 128)].
            updateMaskData.put((animId >> 8) & 0xff, 'BYTE');
            updateMaskData.put(((animId & 0xff) + 128) & 0xff, 'BYTE');
            // ANIM delay read as g1_alt2() → (0 - byte) & 0xff.
            updateMaskData.put((0 - delay) & 0xff, 'BYTE');
        }
    }
}
