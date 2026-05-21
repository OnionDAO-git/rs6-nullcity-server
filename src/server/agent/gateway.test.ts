import { isLoopbackPeerAddress } from './auth';

describe('AgentGateway authorization helpers', () => {
    it('allows tokenless development access only from loopback peers', () => {
        expect(isLoopbackPeerAddress('127.0.0.1')).toBe(true);
        expect(isLoopbackPeerAddress('::1')).toBe(true);
        expect(isLoopbackPeerAddress('::ffff:127.0.0.1')).toBe(true);

        expect(isLoopbackPeerAddress('10.0.0.5')).toBe(false);
        expect(isLoopbackPeerAddress('172.16.0.5')).toBe(false);
        expect(isLoopbackPeerAddress('192.168.1.50')).toBe(false);
    });
});
