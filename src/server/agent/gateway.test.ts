import { isLoopbackPeerAddress } from './auth';
import { recoverRequestId } from './protocol/recover-request-id';

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

// S-DEMO-P0-1 (QA-20260530-018): the parse-failure path now recovers the
// request id (best effort) so the controller resolves its pending request
// immediately. The previous shape sent an error frame without `request_id`
// which left the controller's promise dangling until its 10s timeout —
// surfacing as `Gateway request timed out: burn_resident_gold` in audit.
describe('recoverRequestId', () => {
    it('returns the string id from a parsed frame', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ v: 1, id: 'controller-1-2', kind: 'burn_resident_gold' })))).toBe(
            'controller-1-2',
        );
    });

    it('returns the numeric id from a parsed frame', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ v: 1, id: 42, kind: 'inspect_resident_gold' })))).toBe(42);
    });

    it('accepts string payloads (not just Buffers)', () => {
        expect(recoverRequestId(JSON.stringify({ id: 'req-7' }))).toBe('req-7');
    });

    it('returns undefined when JSON is malformed', () => {
        expect(recoverRequestId(Buffer.from('not json at all'))).toBeUndefined();
    });

    it('returns undefined when id is missing', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ v: 1, kind: 'foo' })))).toBeUndefined();
    });

    it('returns undefined when id is the wrong type', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ id: { nested: true } })))).toBeUndefined();
    });
});
