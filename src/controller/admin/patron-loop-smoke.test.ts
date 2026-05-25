import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { startLettersHttpServer, closeLettersHttpServer } from '../letters/letters-http-server';
import { LettersStore } from '../patron/letters-store';
import { runPatronLoopSmokeCli } from './patron-loop-smoke';

describe('patron loop smoke CLI', () => {
    let tempDir: string;
    let configPath: string;
    let soulsDir: string;
    let memoryDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-patron-smoke-test-'));
        soulsDir = path.join(tempDir, 'souls');
        memoryDir = path.join(tempDir, 'memory');
        configPath = path.join(tempDir, 'controller.yml');
        fs.mkdirSync(soulsDir, { recursive: true });
        fs.mkdirSync(memoryDir, { recursive: true });

        fs.writeFileSync(
            configPath,
            yaml.dump({
                controller: { instanceId: 'test-patron-smoke' },
                residents: ['res:pip'],
                gateway: { url: 'ws://127.0.0.1:1234', controllerId: 'test-controller' },
                inference: { maxConcurrent: 4 },
                souls: { dir: soulsDir },
                memory: { dir: memoryDir, qmdBin: 'qmd' },
                logging: { dir: path.join(tempDir, 'logs'), fullPerceptions: false },
                knowledge: { dir: path.join(tempDir, 'knowledge'), enableSuggestions: false, emitStdout: false, storageMode: 'ephemeral' },
                llm: { endpoints: { default: { timeoutMs: 30000 } } },
            }),
            'utf8',
        );

        fs.writeFileSync(
            path.join(soulsDir, 'pip.md'),
            `---\n${yaml.dump({
                name: 'res:pip',
                archetype: 'achiever',
                attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            })}---\n# res:pip\n`,
            'utf8',
        );
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('proves grant -> offer -> private inbox -> local redacted wall snapshot', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const code = await runPatronLoopSmokeCli(['--human', 'proof@onion', '--resident', 'pip', '--amount', '10', '--config', configPath]);

        expect(code).toBe(0);
        const output = logSpy.mock.calls.map(call => String(call[0])).join('\n');
        expect(output).toContain('PASS private inbox has a standing tier letter');
        expect(output).toContain('PASS local wall snapshot redacts public letter recipients');

        const currency = JSON.parse(fs.readFileSync(path.join(memoryDir, 'patron-currency.json'), 'utf8'));
        expect(currency.balances['proof@onion']).toBe(0);
        const standing = JSON.parse(fs.readFileSync(path.join(memoryDir, 'patron-standing.json'), 'utf8'));
        expect(standing.points['proof@onion|embassy']).toBe(10);

        logSpy.mockRestore();
    });

    it('can verify the live HTTP inbox and wall routes when requested', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const server = await startLettersHttpServer({
            store: new LettersStore(memoryDir),
            port: 0,
            lettersRoot: memoryDir,
            residentIds: ['res:pip'],
            wallRedact: true,
        });

        try {
            const baseUrl = server.url.replace('/v1/inbox', '');
            const code = await runPatronLoopSmokeCli([
                '--human',
                'http-proof@onion',
                '--resident',
                'pip',
                '--amount',
                '10',
                '--config',
                configPath,
                '--http',
                '--letters-base-url',
                baseUrl,
            ]);

            expect(code).toBe(0);
            const output = logSpy.mock.calls.map(call => String(call[0])).join('\n');
            expect(output).toContain('PASS HTTP inbox route serves the letter');
            expect(output).toContain('PASS HTTP wall route serves a redacted snapshot');
        } finally {
            await closeLettersHttpServer(server.server);
            logSpy.mockRestore();
        }
    });
});
