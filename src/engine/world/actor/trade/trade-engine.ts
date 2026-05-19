import type { Player } from '@engine/world/actor/player/player';
import { v4 } from 'uuid';
import { TRADE_REQUEST_RANGE } from './trade-config';
import { type TradeResult, emitTradeEvent, playerActorRef } from './trade-events';
import { TradeSession } from './trade-session';

const keyFor = (player: Player): string => player.username.toLowerCase();

class PlayerTradeEngine {
    private readonly pendingRequests = new Map<string, string>();
    private readonly activeSessions = new Map<string, TradeSession>();

    public beginRequest(from: Player, to: Player): TradeResult {
        if (from.equals(to)) {
            return { ok: false, reason: 'cannot_trade_self' };
        }
        if (!from.isActive || !to.isActive) {
            return { ok: false, reason: 'target_offline' };
        }
        if (this.activeSessionFor(from) || this.activeSessionFor(to)) {
            return { ok: false, reason: 'already_trading' };
        }
        if (from.position.level !== to.position.level || from.position.distanceBetween(to.position) > TRADE_REQUEST_RANGE) {
            return { ok: false, reason: 'target_too_far' };
        }

        const fromKey = keyFor(from);
        const toKey = keyFor(to);
        if (this.pendingRequests.get(toKey) === fromKey) {
            this.pendingRequests.delete(toKey);
            this.pendingRequests.delete(fromKey);
            const session = new TradeSession(v4(), from, to, closed => this.unregisterSession(closed));
            this.activeSessions.set(fromKey, session);
            this.activeSessions.set(toKey, session);
            return { ok: true };
        }

        this.pendingRequests.set(fromKey, toKey);
        emitTradeEvent(to, { kind: 'trade_requested', from: playerActorRef(from) });
        from.sendMessage(`Sending trade offer...`);
        return { ok: true, reason: 'request_sent' };
    }

    public activeSessionFor(player: Player): TradeSession | null {
        return this.activeSessions.get(keyFor(player)) || null;
    }

    public endSessionsFor(player: Player, reason: string): TradeResult {
        const key = keyFor(player);
        this.pendingRequests.delete(key);
        for (const [from, to] of [...this.pendingRequests.entries()]) {
            if (to === key) {
                this.pendingRequests.delete(from);
            }
        }

        const session = this.activeSessions.get(key);
        if (!session) {
            return { ok: true };
        }

        const side = session.sideFor(player);
        return side ? session.decline(side, reason) : { ok: false, reason: 'not_trade_participant' };
    }

    private unregisterSession(session: TradeSession): void {
        this.activeSessions.delete(keyFor(session.a));
        this.activeSessions.delete(keyFor(session.b));
    }
}

export const TradeEngine = new PlayerTradeEngine();
