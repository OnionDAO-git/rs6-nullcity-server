import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { findRecentSay, parsePatronCliArgs, registerPatronInConfig, runPatronCli } from './cli';

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
                kind: 'patron_gift',
                referredId: '',
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
                kind: 'patron_gift',
                referredId: '',
                configPath: 'controller.yml',
            });
        });

        it('parses --ask options correctly', () => {
            const parsed = parsePatronCliArgs(['--ask', '--human', 'james', '--resident', 'pip', '--text', 'What did the fire teach you?']);
            expect(parsed).toEqual({
                action: 'ask',
                humanId: 'james',
                amount: 0,
                residentName: 'pip',
                text: 'What did the fire teach you?',
                artifact: '',
                kind: 'patron_gift',
                referredId: '',
                configPath: 'controller.yml',
            });
        });

        it('parses --witness options correctly (with default amount)', () => {
            const parsed = parsePatronCliArgs(['--witness', '--human=james', '--resident=res:pip', '--artifact=first-fire']);
            expect(parsed).toEqual({
                action: 'witness',
                humanId: 'james',
                amount: 0,
                residentName: 'res:pip',
                text: '',
                artifact: 'first-fire',
                kind: 'patron_gift',
                referredId: '',
                configPath: 'controller.yml',
            });
        });

        it('throws error when action is missing', () => {
            expect(() => parsePatronCliArgs(['--human', 'james'])).toThrow(
                'One of --grant, --offer, --ask, --witness, --register, --checkin, or --referral must be specified.',
            );
        });

        it('parses --checkin options correctly', () => {
            const parsed = parsePatronCliArgs(['--checkin', '--human', 'alice']);
            expect(parsed.action).toBe('checkin');
            expect(parsed.humanId).toBe('alice');
        });

        it('parses --referral options correctly', () => {
            const parsed = parsePatronCliArgs(['--referral', '--human', 'bob', '--referred', 'alice']);
            expect(parsed.action).toBe('referral');
            expect(parsed.humanId).toBe('bob');
            expect(parsed.referredId).toBe('alice');
        });

        it('throws error when --referred is missing for --referral', () => {
            expect(() => parsePatronCliArgs(['--referral', '--human', 'bob'])).toThrow(
                '--referred <new-human> is required for --referral.',
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

        it('E46 staffer UX: auto-generates --artifact when omitted for --witness', () => {
            // Old behavior threw "--artifact <id> is required for --witness."
            // New behavior synthesizes `witness-<resident-slug>-<timestamp>`
            // so embassy staffers don't have to learn another required flag
            // (per E46 SPRINT-QA4 walkthrough finding).
            const options = parsePatronCliArgs(['--witness', '--human', 'james', '--resident', 'pip']);
            expect(options.artifact).toMatch(/^witness-pip-\d+$/);
        });

        it('preserves explicit --artifact when provided', () => {
            const options = parsePatronCliArgs([
                '--witness',
                '--human',
                'james',
                '--resident',
                'pip',
                '--artifact',
                'patrol-2026-06-01-evening',
            ]);
            expect(options.artifact).toBe('patrol-2026-06-01-evening');
        });

        // HD-011 helper: --register adds a handle to controller.yml#patrons[]
        // safely without hand-editing the YAML at event-day door pressure.
        describe('HD-011 --register parser', () => {
            it('parses --register with default kind = patron_gift', () => {
                const options = parsePatronCliArgs(['--register', '--human', 'alice@onion']);
                expect(options.action).toBe('register');
                expect(options.humanId).toBe('alice@onion');
                expect(options.kind).toBe('patron_gift');
            });

            it('accepts --kind override', () => {
                const options = parsePatronCliArgs(['--register', '--human', 'bob@onion', '--kind', 'patron_witness']);
                expect(options.kind).toBe('patron_witness');
            });

            it('rejects unknown --kind value', () => {
                expect(() => parsePatronCliArgs(['--register', '--human', 'a', '--kind', 'patron_zombie'])).toThrow(
                    /--kind must be one of/,
                );
            });

            it('still requires --human for register', () => {
                expect(() => parsePatronCliArgs(['--register'])).toThrow('--human <id> is required.');
            });
        });
    });

    describe('HD-011 registerPatronInConfig', () => {
        let tmpDir: string;
        let configPath: string;
        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patron-register-'));
            configPath = path.join(tmpDir, 'controller.yml');
            fs.writeFileSync(
                configPath,
                yaml.dump({
                    residents: ['res:agent', 'res:hans'],
                    gateway: { url: 'ws://127.0.0.1:43595', controllerId: 'nullcity-controller' },
                    memory: { dir: './data/memory' },
                }),
                'utf8',
            );
        });
        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('appends a new handle to controller.yml#patrons[] (idempotent on re-run)', () => {
            const first = registerPatronInConfig(configPath, 'alice@onion', 'patron_gift');
            expect(first).toEqual({ added: true, total: 1, handle: 'alice@onion', kind: 'patron_gift' });
            const second = registerPatronInConfig(configPath, 'alice@onion', 'patron_gift');
            expect(second).toEqual({ added: false, total: 1, handle: 'alice@onion', kind: 'patron_gift' });

            const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as { patrons: Array<{ handle: string; kind: string }> };
            expect(parsed.patrons).toEqual([{ handle: 'alice@onion', kind: 'patron_gift' }]);
        });

        it('preserves existing non-patron sections (residents, gateway, memory) after write', () => {
            registerPatronInConfig(configPath, 'alice@onion', 'patron_gift');
            const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
            expect(parsed.residents).toEqual(['res:agent', 'res:hans']);
            expect(parsed.gateway).toEqual({ url: 'ws://127.0.0.1:43595', controllerId: 'nullcity-controller' });
            expect(parsed.memory).toEqual({ dir: './data/memory' });
        });

        it('appends a second handle without clobbering the first', () => {
            registerPatronInConfig(configPath, 'alice@onion', 'patron_gift');
            const result = registerPatronInConfig(configPath, 'bob@onion', 'patron_witness');
            expect(result).toEqual({ added: true, total: 2, handle: 'bob@onion', kind: 'patron_witness' });
            const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as { patrons: Array<{ handle: string; kind: string }> };
            expect(parsed.patrons).toEqual([
                { handle: 'alice@onion', kind: 'patron_gift' },
                { handle: 'bob@onion', kind: 'patron_witness' },
            ]);
        });

        it('re-registration with a different kind is a no-op (original kind wins)', () => {
            registerPatronInConfig(configPath, 'alice@onion', 'patron_gift');
            const result = registerPatronInConfig(configPath, 'alice@onion', 'patron_sponsor');
            expect(result).toEqual({ added: false, total: 1, handle: 'alice@onion', kind: 'patron_gift' });
            const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as { patrons: Array<{ handle: string; kind: string }> };
            expect(parsed.patrons).toEqual([{ handle: 'alice@onion', kind: 'patron_gift' }]);
        });

        it('throws when configPath does not parse to a YAML mapping', () => {
            fs.writeFileSync(configPath, 'not_a_map\n- list_at_root\n', 'utf8');
            expect(() => registerPatronInConfig(configPath, 'a', 'patron_gift')).toThrow(/YAML mapping/);
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
            const code = await runPatronCli(['--ask', '--human', 'james', '--resident', 'pip', '--text', question, '-c', configPath]);
            expect(code).toBe(0);

            const timelinePath = path.join(memoryDir, 'library', 'res-pip', 'timeline.jsonl');
            expect(fs.existsSync(timelinePath)).toBe(true);
            const lines = fs.readFileSync(timelinePath, 'utf8').trim().split('\n').filter(Boolean);
            // The LibraryUpdater touches index.json on construct but does NOT
            // write a timeline line on its own; the only line on disk should
            // be our patron_ask append.
            const askLines = lines.map(line => JSON.parse(line)).filter((entry: any) => entry.kind === 'patron_ask');
            expect(askLines).toHaveLength(1);
            expect(askLines[0]).toMatchObject({
                kind: 'patron_ask',
                patronHandle: 'james',
                question,
                significanceReasons: ['patron:patron_ask'],
            });

            logSpy.mockRestore();
        }, 10000);

        it('ask uses the running controller MCP route when configured', async () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            const askRunningController = jest.fn(async () => ({
                ok: true,
                eventId: 'ask-live-1',
                enqueued: true,
            }));

            const code = await runPatronCli(
                ['--ask', '--human', 'james', '--resident', 'pip', '--text', 'Can you answer from the live controller?', '-c', configPath],
                {
                    env: {
                        CONTROLLER_MCP_HTTP_PORT: '43594',
                        CONTROLLER_MCP_TOKENS: 'operator-token',
                    },
                    askRunningController,
                },
            );

            expect(code).toBe(0);
            expect(askRunningController).toHaveBeenCalledWith({
                url: 'http://127.0.0.1:43594/controller/mcp',
                token: 'operator-token',
                humanId: 'james',
                residentName: 'res:pip',
                text: 'Can you answer from the live controller?',
            });
            expect(fs.existsSync(path.join(memoryDir, 'library', 'res-pip', 'timeline.jsonl'))).toBe(false);
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[patron:ask] Live controller enqueued the question.'));

            logSpy.mockRestore();
        }, 10000);

        it('ask fails when --text is empty / whitespace-only', async () => {
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const code = await runPatronCli(['--ask', '--human', 'james', '--resident', 'pip', '--text', '   ', '-c', configPath]);
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

        // J7: daily check-in + referral drips
        describe('J7 check-in (daily +1 Shard)', () => {
            it('credits +1 Shard on first check-in and writes patron-check-in.json', async () => {
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

                const code = await runPatronCli(['--checkin', '--human', 'alice', '-c', configPath]);
                expect(code).toBe(0);

                const currencyFile = path.join(memoryDir, 'patron-currency.json');
                const currency = JSON.parse(fs.readFileSync(currencyFile, 'utf8'));
                expect(currency.balances.alice).toBe(1);

                const checkInFile = path.join(memoryDir, 'patron-check-in.json');
                expect(fs.existsSync(checkInFile)).toBe(true);
                const checkIn = JSON.parse(fs.readFileSync(checkInFile, 'utf8'));
                expect(Object.keys(checkIn.checkInDates)).toContain('alice');

                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[patron:checkin] Credited +1'));
                logSpy.mockRestore();
            });

            it('is idempotent — second call same UTC day is a no-op', async () => {
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

                await runPatronCli(['--checkin', '--human', 'alice', '-c', configPath]);
                const code = await runPatronCli(['--checkin', '--human', 'alice', '-c', configPath]);
                expect(code).toBe(0);

                const currencyFile = path.join(memoryDir, 'patron-currency.json');
                const currency = JSON.parse(fs.readFileSync(currencyFile, 'utf8'));
                expect(currency.balances.alice).toBe(1);

                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already checked in today'));
                logSpy.mockRestore();
            });
        });

        describe('J7 referral (+2 Shards to referrer)', () => {
            it('credits +2 Shards to referrer for a first-time referred human', async () => {
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

                const code = await runPatronCli(['--referral', '--human', 'bob', '--referred', 'alice', '-c', configPath]);
                expect(code).toBe(0);

                const currencyFile = path.join(memoryDir, 'patron-currency.json');
                const currency = JSON.parse(fs.readFileSync(currencyFile, 'utf8'));
                expect(currency.balances.bob).toBe(2);
                expect(currency.balances.alice ?? 0).toBe(0);

                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[patron:referral] Credited +2 Shards'));
                logSpy.mockRestore();
            });

            it('second referral call for same referred human is a no-op', async () => {
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

                await runPatronCli(['--referral', '--human', 'bob', '--referred', 'alice', '-c', configPath]);
                const code = await runPatronCli(['--referral', '--human', 'bob', '--referred', 'alice', '-c', configPath]);
                expect(code).toBe(0);

                const currencyFile = path.join(memoryDir, 'patron-currency.json');
                const currency = JSON.parse(fs.readFileSync(currencyFile, 'utf8'));
                expect(currency.balances.bob).toBe(2);

                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No bonus credited'));
                logSpy.mockRestore();
            });

            it('self-referral is rejected (no bonus credited)', async () => {
                const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

                const code = await runPatronCli(['--referral', '--human', 'alice', '--referred', 'alice', '-c', configPath]);
                expect(code).toBe(0);

                const currencyFile = path.join(memoryDir, 'patron-currency.json');
                const balance = fs.existsSync(currencyFile) ? (JSON.parse(fs.readFileSync(currencyFile, 'utf8')).balances?.alice ?? 0) : 0;
                expect(balance).toBe(0);

                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No bonus credited'));
                logSpy.mockRestore();
            });
        });
    });

    describe('findRecentSay', () => {
        it('finds fresh say lines in the active evidence trajectory path', () => {
            const trajectoryDir = path.join(memoryDir, 'res-pip', 'evidence', 'trajectory');
            fs.mkdirSync(trajectoryDir, { recursive: true });
            const trajectoryPath = path.join(trajectoryDir, '20260524T200000Z-session.jsonl');
            fs.writeFileSync(
                trajectoryPath,
                [
                    JSON.stringify({ kind: 'say', ts: '2026-05-24T19:59:59.000Z', text: 'old line' }),
                    JSON.stringify({ kind: 'say', ts: '2026-05-24T20:00:02.000Z', text: 'fresh live reply' }),
                ].join('\n') + '\n',
                'utf8',
            );
            fs.symlinkSync(path.basename(trajectoryPath), path.join(trajectoryDir, 'current'));

            expect(findRecentSay(memoryDir, 'res:pip', '2026-05-24T20:00:00.000Z')).toBe('fresh live reply');
        });

        it('can filter live ask replies so unrelated speech is not mistaken for an answer', () => {
            const trajectoryDir = path.join(memoryDir, 'res-pip', 'evidence', 'trajectory');
            fs.mkdirSync(trajectoryDir, { recursive: true });
            const trajectoryPath = path.join(trajectoryDir, '20260524T201000Z-session.jsonl');
            fs.writeFileSync(
                trajectoryPath,
                [
                    JSON.stringify({
                        kind: 'say',
                        ts: '2026-05-24T20:10:01.000Z',
                        text: 'I am scouting nearby trees.',
                        cause: 'spark:goal-share',
                    }),
                    JSON.stringify({
                        kind: 'say',
                        ts: '2026-05-24T20:10:02.000Z',
                        text: 'I heard you, hd035-smoke. I will answer what I can while I keep moving.',
                        action: { cause: 'nervous:patron-ask-acknowledge' },
                    }),
                    JSON.stringify({
                        kind: 'say',
                        ts: '2026-05-24T20:10:03.000Z',
                        text: 'Another unrelated later line.',
                        cause: 'spark:goal-share',
                    }),
                ].join('\n') + '\n',
                'utf8',
            );
            fs.symlinkSync(path.basename(trajectoryPath), path.join(trajectoryDir, 'current'));

            expect(
                findRecentSay(memoryDir, 'res:pip', '2026-05-24T20:10:00.000Z', {
                    cause: 'nervous:patron-ask-acknowledge',
                    textIncludes: 'hd035-smoke',
                }),
            ).toBe('I heard you, hd035-smoke. I will answer what I can while I keep moving.');
        });
    });
});
