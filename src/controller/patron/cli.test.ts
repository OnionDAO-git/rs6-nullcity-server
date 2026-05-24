import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { runPatronCli, parsePatronCliArgs } from './cli';

describe('Patron CLI', () => {
    let tempDir: string;
    let configPath: string;
    let soulsDir: string;
    let memoryDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-patron-cli-test-'));
        soulsDir = path.join(tempDir, 'souls');
        memoryDir = path.join(tempDir, 'memory');
        configPath = path.join(tempDir, 'controller.yml');

        fs.mkdirSync(soulsDir, { recursive: true });
        fs.mkdirSync(memoryDir, { recursive: true });

        // Write controller.yml
        const config = {
            controller: { instanceId: 'test-cli-instance' },
            residents: ['res:pip'],
            gateway: { url: 'ws://127.0.0.1:1234', controllerId: 'test-controller' },
            inference: { maxConcurrent: 4 },
            souls: { dir: soulsDir },
            memory: { dir: memoryDir, qmdBin: 'qmd' },
            logging: { dir: path.join(tempDir, 'logs'), fullPerceptions: false },
            knowledge: { dir: path.join(tempDir, 'knowledge'), enableSuggestions: false, emitStdout: false, storageMode: 'ephemeral' },
            llm: { endpoints: { default: { timeoutMs: 30000 } } },
        };
        fs.writeFileSync(configPath, yaml.dump(config), 'utf8');

        // Write resident soul
        const soulFrontmatter = {
            name: 'res:pip',
            archetype: 'achiever',
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
        };
        fs.writeFileSync(path.join(soulsDir, 'pip.md'), `---\n${yaml.dump(soulFrontmatter)}---\n# res:pip`, 'utf8');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('parsePatronCliArgs', () => {
        it('parses --grant options correctly', () => {
            const parsed = parsePatronCliArgs(['--grant', '--human', 'james', '--amount', '10', '-c', 'my-config.yml']);
            expect(parsed).toEqual({
                action: 'grant',
                humanId: 'james',
                amount: 10,
                residentName: '',
                text: '',
                artifact: '',
                configPath: 'my-config.yml',
            });
        });

        it('parses --offer options correctly', () => {
            const parsed = parsePatronCliArgs(['--offer', '--human=james', '--resident=res:pip', '--amount=5']);
            expect(parsed).toEqual({
                action: 'offer',
                humanId: 'james',
                amount: 5,
                residentName: 'res:pip',
                text: '',
                artifact: '',
                configPath: 'controller.yml',
            });
        });

        it('parses --ask options correctly', () => {
            const parsed = parsePatronCliArgs([
                '--ask',
                '--human',
                'james',
                '--resident',
                'pip',
                '--text',
                'What did the fire teach you?',
            ]);
            expect(parsed).toEqual({
                action: 'ask',
                humanId: 'james',
                amount: 0,
                residentName: 'pip',
                text: 'What did the fire teach you?',
                artifact: '',
                configPath: 'controller.yml',
            });
        });

        it('parses --witness options correctly (with default amount)', () => {
            const parsed = parsePatronCliArgs([
                '--witness',
                '--human=james',
                '--resident=res:pip',
                '--artifact=first-fire',
            ]);
            expect(parsed).toEqual({
                action: 'witness',
                humanId: 'james',
                amount: 0,
                residentName: 'res:pip',
                text: '',
                artifact: 'first-fire',
                configPath: 'controller.yml',
            });
        });

        it('throws error when action is missing', () => {
            expect(() => parsePatronCliArgs(['--human', 'james'])).toThrow(
                'One of --grant, --offer, --ask, or --witness must be specified.',
            );
        });

        it('throws error when --human is missing', () => {
            expect(() => parsePatronCliArgs(['--grant', '--amount', '10'])).toThrow('--human <id> is required.');
        });

        it('throws error when --amount is invalid for grant/offer', () => {
            expect(() => parsePatronCliArgs(['--grant', '--human', 'james', '--amount', 'abc'])).toThrow(
                '--amount must be a positive integer.',
            );
            expect(() => parsePatronCliArgs(['--grant', '--human', 'james', '--amount', '-5'])).toThrow(
                '--amount must be a positive integer.',
            );
        });

        it('throws error when --resident is missing for --offer', () => {
            expect(() => parsePatronCliArgs(['--offer', '--human', 'james', '--amount', '5'])).toThrow(
                '--resident <name> is required for --offer.',
            );
        });

        it('throws error when --resident is missing for --ask', () => {
            expect(() => parsePatronCliArgs(['--ask', '--human', 'james', '--text', 'hello?'])).toThrow(
                '--resident <name> is required for --ask.',
            );
        });

        it('throws error when --text is missing for --ask', () => {
            expect(() => parsePatronCliArgs(['--ask', '--human', 'james', '--resident', 'pip'])).toThrow(
                '--text <question> is required for --ask.',
            );
        });

        it('throws error when --resident is missing for --witness', () => {
            expect(() => parsePatronCliArgs(['--witness', '--human', 'james', '--artifact', 'first-fire'])).toThrow(
                '--resident <name> is required for --witness.',
            );
        });

        it('throws error when --artifact is missing for --witness', () => {
            expect(() => parsePatronCliArgs(['--witness', '--human', 'james', '--resident', 'pip'])).toThrow(
                '--artifact <id> is required for --witness.',
            );
        });
    });

    describe('runPatronCli', () => {
        it('grants shards to a human player and writes to currency file', async () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            const code = await runPatronCli(['--grant', '--human', 'james', '--amount', '50', '-c', configPath]);
            expect(code).toBe(0);

            const currencyFile = path.join(memoryDir, 'patron-currency.json');
            expect(fs.existsSync(currencyFile)).toBe(true);

            const data = JSON.parse(fs.readFileSync(currencyFile, 'utf8'));
            expect(data.balances.james).toBe(50);
            expect(data.history.james).toHaveLength(1);
            expect(data.history.james[0].amount).toBe(50);
            expect(data.history.james[0].reason).toBe('cli_grant');

            logSpy.mockRestore();
        });

        it('performs offer to resident successfully', async () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            // First grant some currency
            await runPatronCli(['--grant', '--human', 'james', '--amount', '50', '-c', configPath]);

            // Offer shards to res:pip
            const code = await runPatronCli(['--offer', '--human', 'james', '--resident', 'pip', '--amount', '10', '-c', configPath]);
            expect(code).toBe(0);

            // Check currency balance decreased
            const currencyFile = path.join(memoryDir, 'patron-currency.json');
            const currencyData = JSON.parse(fs.readFileSync(currencyFile, 'utf8'));
            expect(currencyData.balances.james).toBe(40);

            // Check standing ledger was updated
            const standingFile = path.join(memoryDir, 'patron-standing.json');
            expect(fs.existsSync(standingFile)).toBe(true);
            const standingData = JSON.parse(fs.readFileSync(standingFile, 'utf8'));
            expect(standingData.points['james|embassy']).toBe(10);

            // Check attention of resident increased
            const stateFile = path.join(memoryDir, 'res-pip', 'runtime-state.json');
            expect(fs.existsSync(stateFile)).toBe(true);
            const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            expect(stateData.attention).toBe(120); // 100 base + 10 * 2 attention per shard = 120

            // Regression for E6 (intelligence-verification-log.md): the CLI's
            // PatronGateway must construct with a LettersStore so tier-crossing
            // letters reach disk — same wiring ControllerHost gets via EVENT-D1a.
            // Pre-fix: the offer fired tier-crossing but no inbox file existed.
            const inboxFile = path.join(memoryDir, 'data', 'letters', 'james', 'inbox.jsonl');
            expect(fs.existsSync(inboxFile)).toBe(true);
            const inboxLines = fs.readFileSync(inboxFile, 'utf8').trim().split('\n').filter(Boolean);
            expect(inboxLines.length).toBeGreaterThanOrEqual(1);
            const firstLetter = JSON.parse(inboxLines[0]);
            expect(firstLetter.kind).toBe('standing_tier_crossed');
            expect(firstLetter.recipient).toBe('james');
            expect(firstLetter.body).toMatch(/james/);

            logSpy.mockRestore();
        });

        it('fails and returns exit code 1 if resident soul is missing', async () => {
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const code = await runPatronCli([
                '--offer',
                '--human',
                'james',
                '--resident',
                'missing-soul',
                '--amount',
                '10',
                '-c',
                configPath,
            ]);
            expect(code).toBe(1);

            errSpy.mockRestore();
        });

        it('ask writes a patron_ask event to the library timeline', async () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            const question = 'What did the fire teach you, pip?';
            const code = await runPatronCli([
                '--ask',
                '--human',
                'james',
                '--resident',
                'pip',
                '--text',
                question,
                '-c',
                configPath,
            ]);
            expect(code).toBe(0);

            const timelinePath = path.join(memoryDir, 'library', 'res-pip', 'timeline.jsonl');
            expect(fs.existsSync(timelinePath)).toBe(true);
            const lines = fs.readFileSync(timelinePath, 'utf8').trim().split('\n').filter(Boolean);
            // The LibraryUpdater touches index.json on construct but does NOT
            // write a timeline line on its own; the only line on disk should
            // be our patron_ask append.
            const askLines = lines
                .map(line => JSON.parse(line))
                .filter((entry: any) => entry.kind === 'patron_ask');
            expect(askLines).toHaveLength(1);
            expect(askLines[0]).toMatchObject({
                kind: 'patron_ask',
                patronHandle: 'james',
                question,
                significanceReasons: ['patron:patron_ask'],
            });

            logSpy.mockRestore();
        }, 10000);

        it('ask fails when --text is empty / whitespace-only', async () => {
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const code = await runPatronCli([
                '--ask',
                '--human',
                'james',
                '--resident',
                'pip',
                '--text',
                '   ',
                '-c',
                configPath,
            ]);
            // Parser rejects whitespace-only --text upfront.
            expect(code).toBe(1);

            errSpy.mockRestore();
        });

        it('witness records witness + bumps standing by default +3 and persists ledger', async () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            const code = await runPatronCli([
                '--witness',
                '--human',
                'james',
                '--resident',
                'pip',
                '--artifact',
                'first-fire',
                '-c',
                configPath,
            ]);
            expect(code).toBe(0);

            const standingFile = path.join(memoryDir, 'patron-standing.json');
            expect(fs.existsSync(standingFile)).toBe(true);
            const standingData = JSON.parse(fs.readFileSync(standingFile, 'utf8'));
            expect(standingData.points['james|embassy']).toBe(3);

            // Library timeline should have a patron_witness event (written
            // via LibraryUpdater.observePatron from inside the gateway).
            const timelinePath = path.join(memoryDir, 'library', 'res-pip', 'timeline.jsonl');
            expect(fs.existsSync(timelinePath)).toBe(true);
            const witnessLines = fs
                .readFileSync(timelinePath, 'utf8')
                .trim()
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line))
                .filter((entry: any) => entry.kind === 'patron_witness');
            expect(witnessLines).toHaveLength(1);
            expect(witnessLines[0]).toMatchObject({
                kind: 'patron_witness',
                patronHandle: 'james',
                artifact: 'first-fire',
            });

            logSpy.mockRestore();
        });

        it('witness with custom --amount crosses standing tier and sends a letter', async () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            const code = await runPatronCli([
                '--witness',
                '--human',
                'james',
                '--resident',
                'pip',
                '--artifact',
                'first-fire',
                '--amount',
                '12',
                '-c',
                configPath,
            ]);
            expect(code).toBe(0);

            const standingFile = path.join(memoryDir, 'patron-standing.json');
            const standingData = JSON.parse(fs.readFileSync(standingFile, 'utf8'));
            expect(standingData.points['james|embassy']).toBe(12);

            // Tier-crossing letter should be in the inbox.
            const inboxFile = path.join(memoryDir, 'data', 'letters', 'james', 'inbox.jsonl');
            expect(fs.existsSync(inboxFile)).toBe(true);
            const inboxLines = fs.readFileSync(inboxFile, 'utf8').trim().split('\n').filter(Boolean);
            expect(inboxLines.length).toBeGreaterThanOrEqual(1);
            const letter = JSON.parse(inboxLines[0]);
            expect(letter.kind).toBe('standing_tier_crossed');
            expect(letter.subject).toMatch(/acquaintance/i);
            expect(letter.recipient).toBe('james');
            expect(letter.senderResident).toBe('res:pip');

            logSpy.mockRestore();
        });

        it('witness fails for unknown resident soul', async () => {
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const code = await runPatronCli([
                '--witness',
                '--human',
                'james',
                '--resident',
                'missing-soul',
                '--artifact',
                'first-fire',
                '-c',
                configPath,
            ]);
            expect(code).toBe(1);

            errSpy.mockRestore();
        });
    });
});
