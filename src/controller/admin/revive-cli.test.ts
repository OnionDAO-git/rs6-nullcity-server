import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { RuntimeStateStore } from '../memory/runtime-state';
import { parseReviveCliArgs, runReviveCli } from './revive-cli';

describe('revive CLI', () => {
    let tempDir: string;
    let soulsDir: string;
    let memoryDir: string;
    let configPath: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-revive-cli-test-'));
        soulsDir = path.join(tempDir, 'souls');
        memoryDir = path.join(tempDir, 'memory');
        configPath = path.join(tempDir, 'controller.yml');
        fs.mkdirSync(soulsDir, { recursive: true });
        fs.mkdirSync(memoryDir, { recursive: true });

        fs.writeFileSync(
            configPath,
            yaml.dump({
                controller: { instanceId: 'test-revive-cli' },
                residents: ['res:hans'],
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
            path.join(soulsDir, 'hans.md'),
            `---\n${yaml.dump({
                name: 'res:hans',
                archetype: 'mentor',
                attentionProfile: { startingAttention: 14000, decayCurve: 'gentle' },
                respawnPolicy: 'manual',
            })}---\n# Hans`,
            'utf8',
        );
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('parses resident, attention, force, and config options', () => {
        expect(parseReviveCliArgs(['--resident', 'hans', '--attention=9000', '--force', '-c', 'controller.local.yml'])).toEqual({
            residentName: 'hans',
            attention: 9000,
            force: true,
            configPath: 'controller.local.yml',
        });
    });

    it('uses CONTROLLER_CONFIG by default and rejects unknown flags', () => {
        const oldConfig = process.env.CONTROLLER_CONFIG;
        process.env.CONTROLLER_CONFIG = 'controller.env.yml';
        try {
            expect(parseReviveCliArgs(['--resident=hans'])).toMatchObject({
                residentName: 'hans',
                configPath: 'controller.env.yml',
            });
        } finally {
            if (oldConfig === undefined) {
                delete process.env.CONTROLLER_CONFIG;
            } else {
                process.env.CONTROLLER_CONFIG = oldConfig;
            }
        }

        expect(() => parseReviveCliArgs(['--resident', 'hans', '--configg', 'wrong.yml'])).toThrow('Unknown argument --configg');
    });

    it('parses options from environment variables', () => {
        const oldEnv = { ...process.env };
        process.env.CONTROLLER_REVIVE_RESIDENT = 'hans';
        process.env.CONTROLLER_REVIVE_ATTENTION = '9000';
        process.env.CONTROLLER_REVIVE_FORCE = 'true';
        process.env.CONTROLLER_CONFIG = 'controller.env.yml';
        try {
            expect(parseReviveCliArgs([])).toEqual({
                residentName: 'hans',
                attention: 9000,
                force: true,
                configPath: 'controller.env.yml',
            });
        } finally {
            process.env = oldEnv;
        }
    });

    it('revives a configured resident from the command line', async () => {
        const stateStore = new RuntimeStateStore(memoryDir);
        const state = stateStore.load('res:hans', 1, 'mentor');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T12:00:00.000Z',
            tick: 20,
            cause: 'attention_exhausted',
        };
        stateStore.save(state);
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const code = await runReviveCli(['--resident', 'hans', '--config', configPath]);

        expect(code).toBe(0);
        const revived = stateStore.load('res:hans', 1, 'mentor');
        expect(revived.deceased).toBeUndefined();
        expect(revived.attention).toBe(14000);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Revived res:hans'));

        logSpy.mockRestore();
    });

    it('returns exit code 1 when policy blocks the revive', async () => {
        fs.writeFileSync(
            path.join(soulsDir, 'never.md'),
            `---\n${yaml.dump({
                name: 'res:never',
                archetype: 'mentor',
                attentionProfile: { startingAttention: 14000, decayCurve: 'gentle' },
                respawnPolicy: 'never',
            })}---\n# Never`,
            'utf8',
        );
        const stateStore = new RuntimeStateStore(memoryDir);
        const state = stateStore.load('res:never', 1, 'mentor');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T12:00:00.000Z',
            tick: 20,
            cause: 'attention_exhausted',
        };
        stateStore.save(state);
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const code = await runReviveCli(['--resident', 'never', '--config', configPath]);

        expect(code).toBe(1);
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('respawn policy=never'));
        expect(stateStore.load('res:never', 1, 'mentor').deceased?.cause).toBe('attention_exhausted');

        errSpy.mockRestore();
    });
});
