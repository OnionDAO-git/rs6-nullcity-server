import type { PacketData } from '@engine/net/inbound-packet-handler';
import type { Player } from '@engine/world/actor/player/player';
import { filestore } from '@server/game/game-server';
import { ChatHuffman, decodePackedChat } from '../chat-codec';
import { publishPublicChatToNearbyResidents } from '../public-chat-events';

let chatHuffman: ChatHuffman | null | undefined;

const chatPacket = (player: Player, packet: PacketData) => {
    const { buffer } = packet;
    buffer.get('byte');
    const color = buffer.get('byte');
    const effects = buffer.get('byte');
    const data = Buffer.from(buffer.getSlice(buffer.readerIndex, buffer.length - buffer.readerIndex));
    player.updateFlags.addChatMessage({ color, effects, data });

    const message = decodeClientChat(data);
    if (message) {
        publishPublicChatToNearbyResidents(player, message);
    }
};

function decodeClientChat(data: Uint8Array | Int8Array): string | null {
    const codec = getClientChatHuffman();
    if (!codec) {
        return null;
    }

    try {
        return decodePackedChat(data, codec).trim();
    } catch (_error) {
        return null;
    }
}

function getClientChatHuffman(): ChatHuffman | null {
    if (chatHuffman !== undefined) {
        return chatHuffman;
    }

    const binary = filestore?.binaryStore?.getBinaryFile('huffman');
    chatHuffman = binary?.content ? new ChatHuffman(new Uint8Array(binary.content)) : null;
    return chatHuffman;
}

export default {
    opcode: 75,
    size: -3,
    handler: chatPacket,
};
