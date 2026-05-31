import {
    SELF_INITIATED_AP_GP_EXCHANGE_CAUSE,
    SELF_INITIATED_EXCHANGE_AP_PER_GP,
    SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER,
    SELF_INITIATED_EXCHANGE_MAX_GP,
    SELF_INITIATED_EXCHANGE_MIN_GP,
    SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD,
    SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP,
    gpInInventory,
    selfInitiatedApGpExchangeAction,
} from './self-initiated-ap-gp-exchange';

const COIN_ITEM_ID = 995;

describe('gpInInventory', () => {
    it('sums coin item 995 amounts and ignores other items', () => {
        const perception = {
            resident: {
                inventory: [
                    { itemId: 995, amount: 40 },
                    { itemId: 1511, amount: 7 }, // logs, not coins
                    { itemId: 995, amount: 5 },
                ],
            },
        };
        expect(gpInInventory(perception)).toBe(45);
    });

    it('returns 0 when there are no coins or inventory is missing', () => {
        expect(gpInInventory({ resident: { inventory: [{ itemId: 1511, amount: 9 }] } })).toBe(0);
        expect(gpInInventory({ resident: {} })).toBe(0);
        expect(gpInInventory({})).toBe(0);
    });

    it('treats a coin entry without an explicit amount as a single coin', () => {
        expect(gpInInventory({ resident: { inventory: [{ itemId: COIN_ITEM_ID }] } })).toBe(1);
    });
});

describe('selfInitiatedApGpExchangeAction', () => {
    const floor = 100;

    it('fires when AP is below floor+buffer and GP is at or above the minimum', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: floor + 15,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 100 }] } },
        });
        expect(action).toBeDefined();
        expect(action!.kind).toBe('city_exchange_ap_gp');
        expect(action!.cause).toBe(SELF_INITIATED_AP_GP_EXCHANGE_CAUSE);
        expect(SELF_INITIATED_AP_GP_EXCHANGE_CAUSE).toBe('nervous:self-initiated-ap-gp-exchange');
    });

    it('spends enough GP to buy a useful AP runway without spending more than needed', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: floor + 15,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 1000 }] } },
        });
        expect(action).toBeDefined();
        const record = action as unknown as { gpAmount: number; apAmount: number };
        expect(record.gpAmount).toBe(Math.ceil((SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP - 15) / SELF_INITIATED_EXCHANGE_AP_PER_GP));
        expect(record.apAmount).toBe(record.gpAmount * SELF_INITIATED_EXCHANGE_AP_PER_GP);
        expect(SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP).toBe(500);
        expect(SELF_INITIATED_EXCHANGE_MAX_GP).toBe(250);
        expect(SELF_INITIATED_EXCHANGE_AP_PER_GP).toBe(2);
    });

    it('caps the GP spend at SELF_INITIATED_EXCHANGE_MAX_GP when the needed runway is larger than the cap', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: 5,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 1000 }] } },
        });
        expect(action).toBeDefined();
        const record = action as unknown as { gpAmount: number; apAmount: number };
        expect(record.gpAmount).toBe(SELF_INITIATED_EXCHANGE_MAX_GP);
        expect(record.apAmount).toBe(SELF_INITIATED_EXCHANGE_MAX_GP * SELF_INITIATED_EXCHANGE_AP_PER_GP);
    });

    it('spends all GP when the resident holds less than the cap', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: floor + 5,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 30 }] } },
        });
        expect(action).toBeDefined();
        const record = action as unknown as { gpAmount: number; apAmount: number };
        expect(record.gpAmount).toBe(30);
        expect(record.apAmount).toBe(30 * SELF_INITIATED_EXCHANGE_AP_PER_GP);
    });

    it('does not fire when AP is comfortably above the floor+buffer threshold', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: floor + SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER + 1,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 100 }] } },
        });
        expect(action).toBeUndefined();
    });

    it('does not fire when GP in inventory is below the minimum', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: floor + 5,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: SELF_INITIATED_EXCHANGE_MIN_GP - 1 }] } },
        });
        expect(action).toBeUndefined();
        expect(SELF_INITIATED_EXCHANGE_MIN_GP).toBe(10);
    });

    it('does not fire when the resident has already faded (AP <= 0)', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: 0,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 100 }] } },
        });
        expect(action).toBeUndefined();
    });

    it('uses a useful AP runway threshold when the resident has no declared attention floor', () => {
        const firing = selfInitiatedApGpExchangeAction({
            attention: SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD - 1,
            attentionFloor: 0,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 40 }] } },
        });
        expect(firing).toBeDefined();

        const quiet = selfInitiatedApGpExchangeAction({
            attention: SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD,
            attentionFloor: 0,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 40 }] } },
        });
        expect(quiet).toBeUndefined();
        expect(SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD).toBe(300);
    });

    it('buys the missing runway for a no-floor resident under AP pressure', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: 181,
            attentionFloor: 0,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 1000 }] } },
        });

        expect(action).toBeDefined();
        const record = action as unknown as { gpAmount: number; apAmount: number };
        expect(record.gpAmount).toBe(Math.ceil((SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP - 181) / SELF_INITIATED_EXCHANGE_AP_PER_GP));
        expect(record.apAmount).toBe(record.gpAmount * SELF_INITIATED_EXCHANGE_AP_PER_GP);
    });

    it('carries an idempotencyKey when one is provided so the request is replay-safe', () => {
        const action = selfInitiatedApGpExchangeAction({
            attention: floor + 5,
            attentionFloor: floor,
            perception: { resident: { inventory: [{ itemId: COIN_ITEM_ID, amount: 40 }] } },
            idempotencyKey: 'self-exchange-abc',
        });
        expect(action).toBeDefined();
        expect((action as unknown as { idempotencyKey?: string }).idempotencyKey).toBe('self-exchange-abc');
    });
});
