import { parseBenchmarkCliArgs, runBenchmarkCli } from './cli';

describe('benchmark CLI', () => {
    it('parses task, module, config, output, and dry-run flags', () => {
        expect(
            parseBenchmarkCliArgs([
                '--task',
                'make-fire-5m',
                '--module',
                'onion.runescape.standard',
                '--config',
                'controller.yml',
                '--output',
                'data/benchmarks',
                '--dry-run',
            ]),
        ).toEqual({
            taskId: 'make-fire-5m',
            moduleId: 'onion.runescape.standard',
            configPath: 'controller.yml',
            outputDir: 'data/benchmarks',
            dryRun: true,
        });
    });

    it('prints the selected benchmark without touching the gateway in dry-run mode', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'make-fire-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"dryRun":true');
        expect(writes.join('')).toContain('"task":{"id":"make-fire-5m","version":"0.1.0"');
        expect(writes.join('')).toContain('"module":{"id":"onion.runescape.standard","version":"0.1.0"}');
    });

    it('can dry-run the explore-report benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'explore-report-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"explore-report-5m","version":"0.1.0"');
    });
});
