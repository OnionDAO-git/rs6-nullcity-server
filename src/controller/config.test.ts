import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadControllerConfig, productionConfigIssues, sanitizedControllerConfigSummary } from './config';

describe('controller config', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('loads knowledge defaults relative to the config file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        fs.writeFileSync(configPath, '');

        const config = loadControllerConfig(configPath);

        expect(config.controller.instanceId).toMatch(/^local-/);
        expect(config.knowledge).toEqual({
            dir: path.join(root, 'data/knowledge'),
            enableSuggestions: true,
            emitStdout: true,
            storageMode: 'persistent-volume',
            runebenchWikiDir: undefined,
        });
    });

    it('loads Railgun-style knowledge paths from env interpolation', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        process.env.CONTROLLER_INSTANCE_ID = 'railgun-7';
        process.env.CONTROLLER_KNOWLEDGE_DIR = '/data/controller/knowledge';
        process.env.RUNEBENCH_WIKI_DIR = '/app/reference/RuneBench/wiki';
        fs.writeFileSync(
            configPath,
            [
                'controller:',
                '  instanceId: ${CONTROLLER_INSTANCE_ID}',
                'knowledge:',
                '  dir: ${CONTROLLER_KNOWLEDGE_DIR}',
                '  runebenchWikiDir: ${RUNEBENCH_WIKI_DIR}',
                '  enableSuggestions: false',
                '  emitStdout: false',
                '  storageMode: ephemeral',
            ].join('\n'),
        );

        const config = loadControllerConfig(configPath);

        expect(config.controller.instanceId).toBe('railgun-7');
        expect(config.knowledge).toEqual({
            dir: '/data/controller/knowledge',
            runebenchWikiDir: '/app/reference/RuneBench/wiki',
            enableSuggestions: false,
            emitStdout: false,
            storageMode: 'ephemeral',
        });
    });

    it('reports production configuration issues instead of silently accepting local defaults', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        fs.writeFileSync(configPath, '');

        const config = loadControllerConfig(configPath);

        expect(productionConfigIssues(config, { NODE_ENV: 'production' })).toEqual(
            expect.arrayContaining([
                'controller.instanceId must be explicit in production',
                'gateway.url must not use a loopback default in production',
                'memory.dir must be explicit in production',
                'logging.dir must be explicit in production',
                'CONTROLLER_KNOWLEDGE_DIR is required in production when storageMode is persistent-volume',
                'at least one llm endpoint baseUrl is required in production',
            ]),
        );
    });

    it('accepts Railgun-style explicit durable directories in production', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        process.env.CONTROLLER_INSTANCE_ID = 'railgun-7';
        process.env.CONTROLLER_MEMORY_DIR = '/data/controller/memory';
        process.env.CONTROLLER_LOG_DIR = '/data/controller/logs';
        process.env.CONTROLLER_KNOWLEDGE_DIR = '/data/controller/knowledge';
        fs.writeFileSync(
            configPath,
            [
                'controller:',
                '  instanceId: ${CONTROLLER_INSTANCE_ID}',
                'gateway:',
                '  url: wss://gateway.example.test/agent',
                '  controllerId: onion-controller',
                '  authToken: ${GATEWAY_AUTH_TOKEN}',
                'memory:',
                '  dir: ${CONTROLLER_MEMORY_DIR}',
                'logging:',
                '  dir: ${CONTROLLER_LOG_DIR}',
                'knowledge:',
                '  dir: ${CONTROLLER_KNOWLEDGE_DIR}',
                '  storageMode: persistent-volume',
                'llm:',
                '  endpoints:',
                '    default:',
                '      baseUrl: http://inf.nullcity.ai:1234/api/v1',
            ].join('\n'),
        );
        process.env.GATEWAY_AUTH_TOKEN = 'railgun-token';

        const config = loadControllerConfig(configPath);

        expect(productionConfigIssues(config, { RAILGUN: 'true', CONTROLLER_KNOWLEDGE_DIR: '/data/controller/knowledge' })).toEqual([]);
    });

    it('requires gateway auth for remote production gateway control', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        fs.writeFileSync(
            configPath,
            [
                'controller:',
                '  instanceId: railgun-7',
                'gateway:',
                '  url: wss://gateway.example.test/agent',
                '  controllerId: onion-controller',
                'memory:',
                '  dir: /data/controller/memory',
                'logging:',
                '  dir: /data/controller/logs',
                'knowledge:',
                '  dir: /data/controller/knowledge',
                '  storageMode: persistent-volume',
                'llm:',
                '  endpoints:',
                '    default:',
                '      baseUrl: http://inf.nullcity.ai:1234',
            ].join('\n'),
        );

        const config = loadControllerConfig(configPath);

        expect(productionConfigIssues(config, { RAILGUN: 'true' })).toContain(
            'gateway.authToken is required in production when gateway.url is remote',
        );
    });

    it('creates a sanitized startup summary', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        fs.writeFileSync(
            configPath,
            [
                'controller:',
                '  instanceId: instance-1',
                'residents: [res:agent]',
                'gateway:',
                '  url: ws://example.test/agent',
                '  controllerId: controller-1',
                '  authToken: secret-token',
                'llm:',
                '  endpoints:',
                '    default:',
                '      baseUrl: http://llm.test/v1',
                '      apiKey: sk-secret',
            ].join('\n'),
        );

        const summary = sanitizedControllerConfigSummary(loadControllerConfig(configPath));

        expect(summary).toContain('controllerId=controller-1');
        expect(summary).toContain('residents=1');
        expect(summary).not.toContain('secret-token');
        expect(summary).not.toContain('sk-secret');
    });
});
