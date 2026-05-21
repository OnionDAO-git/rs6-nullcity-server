import { assignmentPath, loadSimulationConfig, parseCliOptions } from './lib/config';
import { SimulationGatewayClient } from './lib/client';
import { GoalPlanner } from './lib/goals';
import { SimulationReporter } from './lib/reporter';
import { loadState, saveState, upsertAssignment } from './lib/state';
import type { ActionResult, AgentAction, Perception, ResidentAssignment } from './lib/types';

async function main(): Promise<void> {
    const cli = parseCliOptions(process.argv.slice(2));
    const config = loadSimulationConfig(cli);
    const reporter = new SimulationReporter(config);
    const statePath = assignmentPath(config);
    const state = loadState(statePath);
    const assignments = cli.resident?.length
        ? cli.resident.map(name => {
              const existing = state.residents.find(resident => resident.name === name);
              return (
                  existing ||
                  upsertAssignment(state, name, cli.goal || config.goals[0] || 'wander', { home: config.residents.spawnPosition })
              );
          })
        : state.residents;

    if (!assignments.length) {
        throw new Error('No simulation residents found. Run simulation:birth first or pass --resident.');
    }

    saveState(statePath, state);

    const gateway = new SimulationGatewayClient(config.gateway);
    const planner = new GoalPlanner();
    const byResidentId = new Map<string, ResidentAssignment>();
    const byName = new Map(assignments.map(assignment => [assignment.name, assignment]));
    const actionQueue = new Map<string, Promise<void>>();
    const pendingActions = new Map<string, Map<string, AgentAction>>();

    gateway.on('perception', (residentId, perception) => {
        const assignment = byResidentId.get(residentId) || byName.get(stripResidentId(residentId));
        if (!assignment) {
            return;
        }

        reporter.perception(assignment.name, perception);
        const action = planner.nextAction({
            assignment,
            perception,
            actionIntervalTicks: config.runtime.actionIntervalTicks,
        });
        if (!action) {
            return;
        }

        const previous = actionQueue.get(assignment.name) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                reporter.action(assignment.name, action);
                const requestId = await gateway.submitAction(assignment.name, action);
                queuePendingAction(pendingActions, assignment.name, requestId, action);
            })
            .catch(error => {
                reporter.bug(
                    assignment.name,
                    { severity: 'error', kind: 'infrastructure', reason: 'submit_action_failed' },
                    { error: error.message },
                );
            });
        actionQueue.set(assignment.name, next);
    });

    gateway.on('event', (residentId, event) => {
        const resident = stripResidentId(residentId);
        reporter.event(resident, `resident_event:${event.kind || 'unknown'}`, { event });
    });
    gateway.on('actionResult', (residentId, result: ActionResult, requestId: string | undefined) => {
        const resident = stripResidentId(residentId);
        reporter.action(
            resident,
            requestId
                ? dropPendingAction(pendingActions, resident, requestId) || { kind: 'noop', cause: `unmatched_action_result:${requestId}` }
                : { kind: 'noop', cause: 'missing_action_result_request_id' },
            result,
        );
    });
    gateway.on('serverError', (error, frame) => {
        reporter.bug(undefined, { severity: 'error', kind: 'infrastructure', reason: 'gateway_error' }, { error: error.message, frame });
    });
    gateway.on('disconnect', () => {
        reporter.bug(undefined, { severity: 'error', kind: 'infrastructure', reason: 'gateway_disconnected' }, {});
    });

    await gateway.connect();
    await gateway.hello();
    const knownResidents = new Set((await gateway.listResidents('all')).map(resident => resident.name));

    for (const assignment of assignments) {
        if (!knownResidents.has(assignment.name)) {
            if (!config.runtime.autoBirth) {
                reporter.bug(assignment.name, { severity: 'error', kind: 'infrastructure', reason: 'resident_missing' }, {});
                continue;
            }
            await gateway.createResident(assignment.name, assignment.home || config.residents.spawnPosition);
            reporter.event(assignment.name, 'resident_born', { spawnPosition: assignment.home || config.residents.spawnPosition });
        }

        const connected = await gateway.connectResident(assignment.name);
        byResidentId.set(`resident:${assignment.name}`, assignment);
        reporter.event(assignment.name, 'resident_connected', { resident: connected.resident });
        if (connected.perception) {
            emitInitialPerception(
                planner,
                gateway,
                reporter,
                pendingActions,
                assignment,
                connected.perception,
                config.runtime.actionIntervalTicks,
            );
        }
    }

    await wait(config.runtime.durationMs);
    await Promise.allSettled([...actionQueue.values()]);

    if (config.runtime.disconnectOnStop) {
        await Promise.allSettled(assignments.map(assignment => gateway.disconnectResident(assignment.name, 'simulation_complete')));
    }
    gateway.close();
    process.stdout.write(`Simulation ran ${assignments.length} resident(s) for ${config.runtime.durationMs}ms.\n`);
}

function emitInitialPerception(
    planner: GoalPlanner,
    gateway: SimulationGatewayClient,
    reporter: SimulationReporter,
    pendingActions: Map<string, Map<string, AgentAction>>,
    assignment: ResidentAssignment,
    perception: Perception,
    actionIntervalTicks: number,
): void {
    reporter.perception(assignment.name, perception);
    const action = planner.nextAction({ assignment, perception, actionIntervalTicks });
    if (!action) {
        return;
    }
    reporter.action(assignment.name, action);
    gateway
        .submitAction(assignment.name, action)
        .then(requestId => {
            queuePendingAction(pendingActions, assignment.name, requestId, action);
        })
        .catch(error => {
            reporter.bug(
                assignment.name,
                { severity: 'error', kind: 'infrastructure', reason: 'submit_action_failed' },
                { error: error.message },
            );
        });
}

function queuePendingAction(
    pendingActions: Map<string, Map<string, AgentAction>>,
    resident: string,
    requestId: string,
    action: AgentAction,
): void {
    let pending = pendingActions.get(resident);
    if (!pending) {
        pending = new Map();
        pendingActions.set(resident, pending);
    }
    pending.set(requestId, action);
}

function dropPendingAction(
    pendingActions: Map<string, Map<string, AgentAction>>,
    resident: string,
    requestId: string,
): AgentAction | undefined {
    const pending = pendingActions.get(resident);
    const action = pending?.get(requestId);
    pending?.delete(requestId);
    if (pending && pending.size === 0) {
        pendingActions.delete(resident);
    }
    return action;
}

function stripResidentId(residentId: string): string {
    return residentId.startsWith('resident:') ? residentId.slice('resident:'.length) : residentId;
}

function wait(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
}

main().catch(error => {
    process.stderr.write(`[simulation:run] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
