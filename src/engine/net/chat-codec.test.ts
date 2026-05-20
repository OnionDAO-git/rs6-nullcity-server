import { Filestore } from '@runejs/filestore';
import { ChatHuffman, decodePackedChat, encodePackedChat } from './chat-codec';

describe('chat codec', () => {
    it('round-trips client packed public chat with the cache huffman table', () => {
        const filestore = new Filestore('cache', { xteas: [] });
        const binary = filestore.binaryStore.getBinaryFile('huffman');
        expect(binary?.content).toBeTruthy();

        const codec = new ChatHuffman(new Uint8Array(binary!.content));
        const packed = encodePackedChat('agent follow me', codec);

        expect(decodePackedChat(packed, codec)).toBe('agent follow me');
    });
});
