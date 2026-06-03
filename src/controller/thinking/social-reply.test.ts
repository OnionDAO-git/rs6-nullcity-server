import { isAddressedByName, messageAfterName } from './social-reply';

/**
 * Slice 1 of the resident conversational-reply feature (plan
 * docs/superpowers/plans/2026-06-02-resident-conversational-reply.md): the pure
 * name-detection helpers. A resident engages the conversational path only when a
 * human player says its DISPLAY NAME — matched strictly on a word boundary so
 * "Hansel" never triggers "Hans".
 */
describe('isAddressedByName', () => {
    it('matches the display name on a word boundary, case-insensitively', () => {
        expect(isAddressedByName('Hans, what are you doing?', 'Hans')).toBe(true);
        expect(isAddressedByName('hey hans where to', 'Hans')).toBe(true);
        expect(isAddressedByName('have you seen HANS today', 'Hans')).toBe(true);
    });

    it('does not match a substring (no false trigger inside a longer word)', () => {
        expect(isAddressedByName('Hansel, come here', 'Hans')).toBe(false);
        expect(isAddressedByName('greenhans is a place', 'Hans')).toBe(false);
    });

    it('is false when the display name is missing or empty', () => {
        expect(isAddressedByName('anybody there', undefined)).toBe(false);
        expect(isAddressedByName('anybody there', '')).toBe(false);
    });

    it('handles display names with regex-special characters literally', () => {
        expect(isAddressedByName('hello Mother.Anvil!', 'Mother.Anvil')).toBe(true);
        expect(isAddressedByName('hello MotherXAnvil', 'Mother.Anvil')).toBe(false);
    });
});

describe('messageAfterName', () => {
    it('strips a leading "Name<punct/space>" address prefix, preserving the rest verbatim', () => {
        expect(messageAfterName('Hans, what are you doing?', 'Hans')).toBe('what are you doing?');
        expect(messageAfterName('Hans: come here', 'Hans')).toBe('come here');
        expect(messageAfterName('Hans   stop', 'Hans')).toBe('stop');
    });

    it('returns an empty string when the name is the whole message', () => {
        expect(messageAfterName('Hans', 'Hans')).toBe('');
        expect(messageAfterName('Hans!!!', 'Hans')).toBe('');
    });

    it('leaves the text unchanged when the name is not the leading token', () => {
        // routing only needs "is the remainder a command"; a non-prefix name is left as-is.
        expect(messageAfterName('follow me Hans', 'Hans')).toBe('follow me Hans');
    });
});
