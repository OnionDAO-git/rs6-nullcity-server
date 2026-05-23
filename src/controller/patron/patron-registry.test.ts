import { PatronRegistry } from './patron-registry';

describe('PatronRegistry', () => {
    it('returns undefined and false for unregistered handles', () => {
        const registry = new PatronRegistry();
        expect(registry.isPatron('alice')).toBe(false);
        expect(registry.getKind('alice')).toBeUndefined();
    });

    it('identifies registered patrons case-insensitively', () => {
        const registry = new PatronRegistry([
            { handle: 'Alice@Onion', kind: 'patron_sponsor' },
            { handle: 'Bob@Onion', kind: 'patron_gift' },
        ]);

        expect(registry.isPatron('alice@onion')).toBe(true);
        expect(registry.isPatron('ALICE@ONION')).toBe(true);
        expect(registry.getKind('alice@onion')).toBe('patron_sponsor');
        expect(registry.getKind('Bob@Onion')).toBe('patron_gift');
    });
});
