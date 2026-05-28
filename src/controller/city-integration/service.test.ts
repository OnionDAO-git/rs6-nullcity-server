import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RuntimeState } from '../memory/runtime-state';
import { CityIntegrationError, CityIntegrationService, type CityRuntime } from './service';

class FakeRuntime implements CityRuntime {
    readonly events: unknown[] = [];
    readonly state: RuntimeState = {
        resident: 'res:test',
        attention: 10,
        tick: 7,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: '2026-05-27T00:00:00.000Z',
            dayStartedAt: '2026-05-27T00:00:00.000Z',
            requestsThisMinute: 0,
            requestsToday: 0,
        },
    };

    incrementAttention(amount: number): void {
        this.state.attention += amount;
    }

    getState(): RuntimeState {
        return this.state;
    }

    onEvent(event: unknown): void {
        this.events.push(event);
    }
}

describe('CityIntegrationService', () => {
    let root: string;
    let runtime: FakeRuntime;
    let gold: number;
    let burnCalls: number;
    let birthCalls: number;
    let service: CityIntegrationService;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'city-integration-'));
        runtime = new FakeRuntime();
        gold = 100;
        burnCalls = 0;
        birthCalls = 0;
        service = new CityIntegrationService({
            memoryRoot: root,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: resident => (resident === 'res:test' ? runtime : undefined),
            inventory: {
                inspectResidentGold: async resident => ({ resident, itemId: 995, amount: gold }),
                burnResidentGold: async (resident, amount) => {
                    burnCalls += 1;
                    if (gold < amount) {
                        throw new Error('EINSUFFICIENT_GOLD');
                    }
                    gold -= amount;
                    return { resident, itemId: 995, burnedAmount: amount, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => {
                    birthCalls += 1;
                    return { resident: input.residentName, created: true, connected: true };
                },
            },
        });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('credits resident attention once per idempotency key', async () => {
        const first = await service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 5 });
        const replay = await service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 5 });

        expect(first).toMatchObject({ ok: true, attentionBefore: 10, attentionAfter: 15, creditedAmount: 5 });
        expect(replay).toMatchObject({ ok: true, attentionBefore: 10, attentionAfter: 15, idempotent: true });
        expect(runtime.state.attention).toBe(15);
    });

    it('rejects idempotency key reuse with a different attention payload', async () => {
        await service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 5 });

        await expect(service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 6 })).rejects.toMatchObject({
            status: 409,
            code: 'idempotency_payload_mismatch',
        });
    });

    it('returns insufficient gold without burning coins', async () => {
        const result = await service.burnGold('res:test', { idempotencyKey: 'gold-1', amount: 150 });

        expect(result).toMatchObject({ ok: false, error: 'insufficient_gold', requestedAmount: 150 });
        expect(gold).toBe(100);
        expect(burnCalls).toBe(1);
    });

    it('burns gold once and replays the same idempotent result', async () => {
        const first = await service.burnGold('res:test', { idempotencyKey: 'gold-2', amount: 40 });
        const replay = await service.burnGold('res:test', { idempotencyKey: 'gold-2', amount: 40 });

        expect(first).toMatchObject({ ok: true, burnedAmount: 40, remainingAmount: 60 });
        expect(replay).toMatchObject({ ok: true, burnedAmount: 40, remainingAmount: 60, idempotent: true });
        expect(gold).toBe(60);
        expect(burnCalls).toBe(1);
    });

    it('validates birth payloads before calling the birth authority', async () => {
        await expect(
            service.birthResident({
                proposalId: 'proposal-1',
                residentName: 'bad-name',
                soulMarkdown: '# missing frontmatter',
                fundedAttention: 500,
            }),
        ).rejects.toBeInstanceOf(CityIntegrationError);
        expect(birthCalls).toBe(0);
    });

    it('births a valid proposal payload idempotently', async () => {
        const payload = {
            proposalId: 'proposal-1',
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            fundedAttention: 500,
        };

        const first = await service.birthResident(payload);
        const replay = await service.birthResident(payload);

        expect(first).toMatchObject({ ok: true, proposalId: 'proposal-1', resident: 'res:test' });
        expect(replay).toMatchObject({ ok: true, resident: 'res:test', idempotent: true });
        expect(birthCalls).toBe(1);
    });

    it('delivers a human inbox message as a resident event and library event', async () => {
        const result = await service.deliverMessage('res:test', {
            messageId: 'msg-1',
            threadId: 'thread-1',
            cityUserId: 'user-1',
            senderDisplayName: 'Alice',
            body: 'Can you find the blue moon inn?',
        });

        expect(result).toMatchObject({ ok: true, delivered: true });
        expect(runtime.events).toHaveLength(1);
        expect(runtime.events[0]).toMatchObject({
            kind: 'human_inbox_message',
            text: 'Can you find the blue moon inn?',
            threadId: 'thread-1',
            messageId: 'msg-1',
        });
        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const event = JSON.parse(fs.readFileSync(timelinePath, 'utf8').trim());
        expect(event).toMatchObject({
            kind: 'city_inbox_message',
            cityUserId: 'user-1',
            senderDisplayName: 'Alice',
            messageId: 'msg-1',
        });
    });
});

function soulMarkdown(name: string): string {
    return [
        '---',
        `name: ${name}`,
        'archetype: endurer',
        'goals:',
        '  - learn the city',
        'attentionProfile:',
        '  startingAttention: 100',
        '  decayCurve: standard',
        '---',
        '',
        `# ${name}`,
        '',
        'Born from a city proposal.',
    ].join('\n');
}
