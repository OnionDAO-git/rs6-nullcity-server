import { assignmentPath, loadSimulationConfig, parseCliOptions } from './lib/config';
import { loadState, saveState, upsertAssignment } from './lib/state';

async function main(): Promise<void> {
    const cli = parseCliOptions(process.argv.slice(2));
    const config = loadSimulationConfig(cli);
    const statePath = assignmentPath(config);
    const state = loadState(statePath);
    const goal = cli.goal || config.goals[0] || 'wander';
    const targets = cli.resident?.length ? cli.resident : state.residents.map(resident => resident.name);

    if (!targets.length) {
        throw new Error('No residents to assign. Run simulation:birth first or pass --resident.');
    }

    for (const name of targets) {
        upsertAssignment(state, name, goal, {
            home: cli.spawnPosition || state.residents.find(resident => resident.name === name)?.home || config.residents.spawnPosition,
            notes: 'assigned by simulation/assign-goals',
        });
    }

    saveState(statePath, state);
    process.stdout.write(`Assigned goal "${goal}" to ${targets.length} resident(s).\n`);
}

main().catch(error => {
    process.stderr.write(`[simulation:assign-goals] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
