import { loadControllerConfig, parseControllerArgs } from './config';
import { ControllerHost } from './controller-host';

async function main(): Promise<void> {
    const args = parseControllerArgs(process.argv.slice(2));
    const config = loadControllerConfig(args.configPath);
    const host = new ControllerHost(config, { once: args.once, logEnvelope: args.logEnvelope });

    const shutdown = async () => {
        await host.stop();
        process.exit(0);
    };

    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());

    await host.start();
    if (args.once) {
        await host.stop();
    }
}

main().catch(error => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`[controller] ${message}\n`);
    process.exitCode = 1;
});
