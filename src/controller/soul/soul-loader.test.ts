import path from 'path';
import { SoulLoader } from './soul-loader';

describe('SoulLoader', () => {
    it('loads starter souls named with the resident prefix and a dash', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        const soul = loader.load('res:pip');

        expect(soul.frontmatter.name).toBe('res:pip');
        expect(soul.frontmatter.display).toBe('Pip');
    });

    it('loads the starter agent with the standard SPARK module selected', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        const soul = loader.load('res:agent');

        expect(soul.frontmatter.modules).toEqual([{ id: 'onion.runescape.standard', enabled: true }]);
    });
});
