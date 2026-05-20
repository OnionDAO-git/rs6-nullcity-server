import { assignmentPath, generatedResidentName, loadSimulationConfig, parseCliOptions } from './lib/config';
import { SimulationGatewayClient } from './lib/client';
import { SimulationReporter } from './lib/reporter';
import { loadState, saveState, upsertAssignment } from './lib/state';

async function main(): Promise<void> {
    const cli = parseCliOptions(process.argv.slice(2));
    const config = loadSimulationConfig(cli);
    const reporter = new SimulationReporter(config);
    const statePath = assignmentPath(config);
    const state = loadState(statePath);
    const existing = new Set(state.residents.map(resident => resident.name));
    const residents = cli.resident?.length ? cli.resident : generateNames(config.residents.prefix, config.residents.count, existing);
    const goal = cli.goal || config.goals[0] || 'wander';

    const gateway = new SimulationGatewayClient(config.gateway);
    await gateway.connect();
    await gateway.hello();
    const knownResidents = new Set((await gateway.listResidents('all')).map(resident => resident.name));

    for (const name of residents) {
        const normalized = name.toLowerCase();
        if (!knownResidents.has(normalized)) {
            await gateway.createResident(normalized, cli.spawnPosition || config.residents.spawnPosition);
            reporter.event(normalized, 'resident_born', { spawnPosition: cli.spawnPosition || config.residents.spawnPosition });
        }

        upsertAssignment(state, normalized, goal, {
            home: cli.spawnPosition || config.residents.spawnPosition,
            bornAt: new Date().toISOString(),
        });
    }

    saveState(statePath, state);
    gateway.close();
    process.stdout.write(`Born or registered ${residents.length} simulation resident(s).\n`);
}

function generateNames(prefix: string, count: number, existing: Set<string>): string[] {
    const names: string[] = [];
    for (let index = 1; names.length < count; index += 1) {
        const name = generatedResidentName(prefix, index);
        if (!existing.has(name)) {
            names.push(name);
        }
    }
    return names;
}

main().catch(error => {
    process.stderr.write(`[simulation:birth] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
