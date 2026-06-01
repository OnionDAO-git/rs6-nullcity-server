import { parseEnsureInventoryArgs, runEnsureInventoryCli, type EnsureInventoryGateway } from './ensure-inventory';

describe('ensure inventory CLI', () => {
    it('parses resident, item, amount, and config options', () => {
        expect(
            parseEnsureInventoryArgs(['--resident', 'res:qa-survivor', '--item=303', '--amount', '1', '-c', 'controller.local.yml']),
        ).toEqual({
            resident: 'res:qa-survivor',
            item: 303,
            amount: 1,
            configPath: 'controller.local.yml',
        });
    });

    it('rejects missing or invalid required options', () => {
        expect(() => parseEnsureInventoryArgs(['--item', '303'])).toThrow('--resident <name> is required');
        expect(() => parseEnsureInventoryArgs(['--resident', 'res:qa-survivor'])).toThrow('--item <id-or-key> is required');
        expect(() => parseEnsureInventoryArgs(['--resident', 'res:qa-survivor', '--item', '303', '--amount', '0'])).toThrow(
            '--amount must be a positive integer',
        );
    });

    it('runs against an injected gateway and reports the ensured item summary', async () => {
        const gateway: EnsureInventoryGateway = {
            connect: jest.fn(async () => undefined),
            hello: jest.fn(async () => undefined),
            ensureInventoryItem: jest.fn(async () => ({
                resident: 'res:qa-survivor',
                itemId: 303,
                requestedAmount: 1,
                previousAmount: 0,
                amount: 1,
                addedAmount: 1,
            })),
            close: jest.fn(),
        };
        const stdout = jest.fn();

        await expect(
            runEnsureInventoryCli(['--resident', 'res:qa-survivor', '--item', '303'], {
                gatewayFactory: () => gateway,
                stdout,
            }),
        ).resolves.toBe(0);

        expect(gateway.ensureInventoryItem).toHaveBeenCalledWith('res:qa-survivor', 303, 1);
        expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"addedAmount":1'));
        expect(gateway.close).toHaveBeenCalled();
    });
});
