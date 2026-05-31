import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadControllerConfig, parseControllerArgs, productionConfigIssues, sanitizedControllerConfigSummary } from './config';

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
        expect(config.souls).toEqual({
            dir: path.join(root, 'data/souls'),
            discoverResidents: true,
        });
        expect(config.knowledge).toEqual({
            dir: path.join(root, 'data/knowledge'),
            enableSuggestions: true,
            emitStdout: true,
            storageMode: 'persistent-volume',
            runebenchWikiDir: undefined,
        });
    });

    it('can disable starter soul discovery for a configured live cohort', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        fs.writeFileSync(
            configPath,
            ['residents:', '  - res:agent', 'souls:', '  dir: ./src/controller/soul/starter-souls', '  discoverResidents: false'].join(
                '\n',
            ),
        );

        const config = loadControllerConfig(configPath);

        expect(config.residents).toEqual(['res:agent']);
        expect(config.souls).toEqual({
            dir: path.join(root, 'src/controller/soul/starter-souls'),
            discoverResidents: false,
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

    it('ships a tracked inference canary config for the loaded owned-hardware models', () => {
        const config = loadControllerConfig(path.join(process.cwd(), 'config/controller.inference-canary.yml'));

        // S-INFER-8-DEPLOY-AUDIT-1 keeps the canary on the owned qwopus route,
        // but uses the serving alias because the exact @q4_k_s id is listed yet
        // rejects even tiny probes on both owned boxes.
        expect(config.llm.endpoints.default).toMatchObject({
            baseUrl: 'http://spacetower.nullcity.ai:8100',
            model: 'qwopus3.5-27b-v3',
            timeoutMs: 240000,
            maxTokens: 512,
            forceThinking: false,
        });
        expect(config.llm.endpoints.spacetower_qwopus_q4).toMatchObject({
            baseUrl: 'http://spacetower.nullcity.ai:8100',
            model: 'qwopus3.5-27b-v3',
            timeoutMs: 30000,
            maxTokens: 512,
            forceThinking: false,
        });
        expect(config.llm.endpoints.spacetower_qwen).toBeUndefined();
        expect(config.llm.endpoints.inf_qwopus_q4).toMatchObject({
            baseUrl: 'http://inf.nullcity.ai:1234',
            model: 'qwopus3.5-27b-v3',
            timeoutMs: 240000,
            maxTokens: 512,
            forceThinking: false,
        });
    });

    it('resolves model profiles separately from endpoint hardware definitions', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-config-'));
        const configPath = path.join(root, 'controller.yml');
        process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
        fs.writeFileSync(
            configPath,
            [
                'llm:',
                '  endpoints:',
                '    spacetower:',
                '      provider: openai-compatible',
                '      baseUrl: http://spacetower.nullcity.ai:8100',
                '      timeoutMs: 30000',
                '      maxTokens: 512',
                '      forceThinking: false',
                '    openrouter:',
                '      provider: openrouter',
                '      baseUrl: https://openrouter.ai/api',
                '      apiKey: ${OPENROUTER_API_KEY}',
                '      responseFormat: text',
                '  profiles:',
                '    default:',
                '      endpoint: spacetower',
                '      model: qwopus3.5-27b-v3@q4_k_s',
                '    haiku:',
                '      endpoint: openrouter',
                '      model: anthropic/claude-3.5-haiku',
                '      timeoutMs: 45000',
                '      forceThinking: true',
                '      cost:',
                '        promptTokenUsd: 0.0000008',
                '        completionTokenUsd: 0.000004',
            ].join('\n'),
        );

        const config = loadControllerConfig(configPath);

        expect(config.llm.profiles.default).toMatchObject({
            profileId: 'default',
            endpointId: 'spacetower',
            provider: 'openai-compatible',
            baseUrl: 'http://spacetower.nullcity.ai:8100',
            model: 'qwopus3.5-27b-v3@q4_k_s',
            timeoutMs: 30000,
            maxTokens: 512,
            forceThinking: false,
        });
        expect(config.llm.profiles.haiku).toMatchObject({
            profileId: 'haiku',
            endpointId: 'openrouter',
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api',
            apiKey: 'test-openrouter-key',
            model: 'anthropic/claude-3.5-haiku',
            responseFormat: 'text',
            timeoutMs: 45000,
            forceThinking: true,
            cost: {
                promptTokenUsd: 0.0000008,
                completionTokenUsd: 0.000004,
            },
        });
        expect(config.llm.endpoints.haiku).toEqual(config.llm.profiles.haiku);
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

    it('parses optional controller MCP HTTP flags and env defaults', () => {
        process.env.CONTROLLER_MCP_HTTP_PORT = '43597';
        process.env.CONTROLLER_MCP_HTTP_HOST = '127.0.0.2';
        process.env.CONTROLLER_MCP_HTTP_PATH = '/mcp/env';

        expect(parseControllerArgs([])).toEqual(
            expect.objectContaining({
                mcpHttpPort: 43597,
                mcpHttpHost: '127.0.0.2',
                mcpHttpPath: '/mcp/env',
            }),
        );

        expect(parseControllerArgs(['--mcp-http-port', '43600', '--mcp-http-host=127.0.0.1', '--mcp-http-path', '/mcp/test'])).toEqual(
            expect.objectContaining({
                mcpHttpPort: 43600,
                mcpHttpHost: '127.0.0.1',
                mcpHttpPath: '/mcp/test',
            }),
        );
    });

    it('rejects invalid controller MCP HTTP ports', () => {
        expect(() => parseControllerArgs(['--mcp-http-port', 'nope'])).toThrow('--mcp-http-port must be an integer port');
        expect(() => parseControllerArgs(['--mcp-http-port=70000'])).toThrow('--mcp-http-port must be an integer port');
    });

    it('parses optional letters HTTP flags and env defaults (EVENT-D2c)', () => {
        process.env.CONTROLLER_LETTERS_HTTP_PORT = '43598';
        process.env.CONTROLLER_LETTERS_HTTP_HOST = '127.0.0.3';
        process.env.CONTROLLER_LETTERS_HTTP_PATH = '/letters/env';
        process.env.CONTROLLER_LETTERS_HTTP_WALL_REDACT = 'true';

        expect(parseControllerArgs([])).toEqual(
            expect.objectContaining({
                lettersHttpPort: 43598,
                lettersHttpHost: '127.0.0.3',
                lettersHttpPath: '/letters/env',
                lettersHttpWallRedact: true,
            }),
        );

        expect(
            parseControllerArgs([
                '--letters-http-port',
                '43601',
                '--letters-http-host=127.0.0.1',
                '--letters-http-path',
                '/v1/inbox',
                '--letters-http-wall-redact',
            ]),
        ).toEqual(
            expect.objectContaining({
                lettersHttpPort: 43601,
                lettersHttpHost: '127.0.0.1',
                lettersHttpPath: '/v1/inbox',
                lettersHttpWallRedact: true,
            }),
        );
    });

    it('defaults letters HTTP host to 127.0.0.1 and path to /v1/inbox when env unset (EVENT-D2c)', () => {
        delete process.env.CONTROLLER_LETTERS_HTTP_PORT;
        delete process.env.CONTROLLER_LETTERS_HTTP_HOST;
        delete process.env.CONTROLLER_LETTERS_HTTP_PATH;
        delete process.env.CONTROLLER_LETTERS_HTTP_WALL_REDACT;

        expect(parseControllerArgs([])).toEqual(
            expect.objectContaining({
                lettersHttpPort: undefined,
                lettersHttpHost: '127.0.0.1',
                lettersHttpPath: '/v1/inbox',
                lettersHttpWallRedact: false,
            }),
        );
    });

    it('accepts --wall-redact as the short event-wall alias for letters HTTP redaction (HD-029)', () => {
        expect(parseControllerArgs(['--wall-redact'])).toEqual(
            expect.objectContaining({
                lettersHttpWallRedact: true,
            }),
        );
    });

    it('accepts CONTROLLER_ONCE, CONTROLLER_LOG_ENVELOPE, and CONTROLLER_WALL_REDACT env variables', () => {
        process.env.CONTROLLER_ONCE = 'true';
        process.env.CONTROLLER_LOG_ENVELOPE = '1';
        process.env.CONTROLLER_WALL_REDACT = 'true';

        expect(parseControllerArgs([])).toEqual(
            expect.objectContaining({
                once: true,
                logEnvelope: true,
                lettersHttpWallRedact: true,
            }),
        );
    });

    it('rejects invalid letters HTTP ports (EVENT-D2c)', () => {
        delete process.env.CONTROLLER_LETTERS_HTTP_PORT;
        expect(() => parseControllerArgs(['--letters-http-port', 'nope'])).toThrow('--letters-http-port must be an integer port');
        expect(() => parseControllerArgs(['--letters-http-port=70000'])).toThrow('--letters-http-port must be an integer port');
    });

    it('parses optional city integration HTTP flags and env defaults', () => {
        process.env.CONTROLLER_CITY_HTTP_PORT = '43620';
        process.env.CONTROLLER_CITY_HTTP_HOST = '127.0.0.4';
        process.env.CONTROLLER_CITY_HTTP_PATH_PREFIX = '/city/nullcity';
        process.env.CONTROLLER_CITY_HTTP_TOKEN = 'city-secret';

        expect(parseControllerArgs([])).toEqual(
            expect.objectContaining({
                cityHttpPort: 43620,
                cityHttpHost: '127.0.0.4',
                cityHttpPathPrefix: '/city/nullcity',
                cityHttpToken: 'city-secret',
            }),
        );

        expect(
            parseControllerArgs([
                '--city-http-port',
                '43621',
                '--city-http-host=127.0.0.1',
                '--city-http-path-prefix',
                '/api/nullcity',
                '--city-http-token=cli-secret',
            ]),
        ).toEqual(
            expect.objectContaining({
                cityHttpPort: 43621,
                cityHttpHost: '127.0.0.1',
                cityHttpPathPrefix: '/api/nullcity',
                cityHttpToken: 'cli-secret',
            }),
        );
    });

    it('rejects invalid city integration HTTP ports', () => {
        delete process.env.CONTROLLER_CITY_HTTP_PORT;
        expect(() => parseControllerArgs(['--city-http-port', 'nope'])).toThrow('--city-http-port must be an integer port');
        expect(() => parseControllerArgs(['--city-http-port=70000'])).toThrow('--city-http-port must be an integer port');
    });
});
