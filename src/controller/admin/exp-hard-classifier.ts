import fs from 'fs';
import path from 'path';
import type { NamedCombatSoakLogEntry } from './named-combat-soak';

export type FailureClass = 'DESIGN' | 'INFERENCE' | 'BODY' | 'PERCEPTION' | 'KNOWLEDGE' | 'ENGINE';

export interface ExpHardObservation {
    observationId: string;
    t?: string;
    primaryClass: FailureClass;
    secondaryClasses: FailureClass[];
    evidence: string[];
    suggestedFix: string;
}

export interface ExpHardClassifierInput {
    entries: NamedCombatSoakLogEntry[];
    events: Array<Record<string, unknown>>;
    metrics: Record<string, number>;
    catatonicLoopDetected?: boolean;
    durationMs?: number;
    resident?: string;
}

export interface ExpHardClassification {
    observations: ExpHardObservation[];
    classCounts: Record<FailureClass, number>;
    dominantClass?: FailureClass;
    axisSurface: boolean;
    axisDiversity: boolean;
    axisYield: boolean;
    summary: string;
}

const FAILURE_CLASSES: FailureClass[] = ['DESIGN', 'INFERENCE', 'BODY', 'PERCEPTION', 'KNOWLEDGE', 'ENGINE'];

export function classifyExpHardRun(input: ExpHardClassifierInput): ExpHardClassification {
    const observations: ExpHardObservation[] = [];
    let id = 0;
    const nextId = () => `OBS-${String(++id).padStart(3, '0')}`;

    const { entries, events, metrics, catatonicLoopDetected, durationMs = 0 } = input;

    // BODY: catatonic loop — N consecutive identical actions
    if (catatonicLoopDetected) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'BODY',
            secondaryClasses: [],
            evidence: [`metrics.catatonicLoopDetected=true`],
            suggestedFix:
                'src/controller/admin/named-combat-soak.ts detectCatatonicLoop — add action-kind diversity check in body adapter (src/controller/thinking/hybrid-agent-thinking-module.ts)',
        });
    }

    // INFERENCE: no perception received → likely gateway/inference not responding
    if (metrics.perceptionCount === 0) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'INFERENCE',
            secondaryClasses: ['ENGINE'],
            evidence: [`metrics.perceptionCount=0`],
            suggestedFix: 'Check gateway connection and controller LLM endpoint health before retrying soak',
        });
    }

    // BODY: no combat command was submitted (harness failure)
    if (metrics.commandSubmitted === 0) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'BODY',
            secondaryClasses: [],
            evidence: [`metrics.commandSubmitted=0`],
            suggestedFix:
                'src/controller/admin/named-combat-soak.ts — command peer failed to connect or submitAction timed out; check gateway health',
        });
    }

    // DESIGN: unsafe target attacked — resident selected wrong target
    if (metrics.unsafeAttackActions > 0) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'DESIGN',
            secondaryClasses: ['KNOWLEDGE'],
            evidence: [`metrics.unsafeAttackActions=${metrics.unsafeAttackActions}`],
            suggestedFix:
                'src/controller/spark/runescape-body-routines.ts safe-combat guard — verify UNSAFE_TARGET_PATTERN covers all live NPC names at spawn; add combat-level cap to body routine',
        });
    }

    // BODY: high action failure rate — engine not acking actions
    const totalAttacks = metrics.attackActions ?? 0;
    const failedAttacks = metrics.failedAttackActions ?? 0;
    if (totalAttacks > 0 && failedAttacks / totalAttacks > 0.5) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'BODY',
            secondaryClasses: ['PERCEPTION'],
            evidence: [`metrics.failedAttackActions=${failedAttacks}`, `metrics.attackActions=${totalAttacks}`],
            suggestedFix:
                'src/controller/actions/action-coordinator.ts — check target-not-found handling; verify attack waypoints reach NPC in Lumbridge courtyard',
        });
    }

    // DESIGN: resident died and made zero survival/eat actions — missing eat reflex
    if (metrics.deathEvents > 0 && (metrics.survivalActions ?? 0) === 0) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'DESIGN',
            secondaryClasses: [],
            evidence: [`metrics.deathEvents=${metrics.deathEvents}`, `metrics.survivalActions=0`],
            suggestedFix:
                'src/controller/nervous-system/rules-md.ts — eat-when-low-health rule may have wrong HP threshold or wrong item check; verify nervous-system.test.ts covers death path',
        });
    }

    // DESIGN: low-health refusal without ever attacking — over-cautious reflex
    if ((metrics.lowHealthRefusals ?? 0) > 0 && (metrics.safeAttackActions ?? 0) === 0) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'DESIGN',
            secondaryClasses: ['KNOWLEDGE'],
            evidence: [`metrics.lowHealthRefusals=${metrics.lowHealthRefusals}`, `metrics.safeAttackActions=0`],
            suggestedFix:
                'src/controller/nervous-system — low-health refusal fires when HP is still manageable; check nervous-system HP threshold; resident may need food seed or fishing route first',
        });
    }

    // KNOWLEDGE: no bone burial despite likely having bones
    if ((metrics.bonesEvidence ?? 0) === 0 && (metrics.safeAttackActions ?? 0) >= 2) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'KNOWLEDGE',
            secondaryClasses: ['DESIGN'],
            evidence: [`metrics.bonesEvidence=0`, `metrics.safeAttackActions=${metrics.safeAttackActions}`],
            suggestedFix:
                'src/controller/spark/runescape-body-routines.ts — bury-bones routine may not fire after combat loot; check SPARK module knowledge entry for prayer/bone-burial',
        });
    }

    // INFERENCE: low throughput — many ticks elapsed but few actions
    const ordinaryActions = metrics.ordinaryActionEntries ?? 0;
    if (durationMs > 60_000 && ordinaryActions < 10) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'INFERENCE',
            secondaryClasses: ['BODY'],
            evidence: [`metrics.ordinaryActionEntries=${ordinaryActions}`, `durationMs=${durationMs}`],
            suggestedFix:
                'Check LLM endpoint is responding and brain decisions are not all empty_completion; run inference-health-audit to measure usable brain decision rate',
        });
    }

    // PERCEPTION: high stale-target failures — target moved between decision and action
    const staleTargetFailures = countStaleTargetFailures(entries);
    if (staleTargetFailures >= 3) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'PERCEPTION',
            secondaryClasses: ['BODY'],
            evidence: [`staleTargetFailures=${staleTargetFailures}`],
            suggestedFix:
                'src/controller/actions/action-coordinator.ts movementWaitToEffect — verify target not filtered by stale failure cooldown after valid intermediate movement; check target_failure_cooldown config',
        });
    }

    // ENGINE: death events without unsafe attacks or missed combat evidence
    if (metrics.deathEvents > 0 && metrics.unsafeAttackActions === 0 && (metrics.combatEvidence ?? 0) === 0) {
        observations.push({
            observationId: nextId(),
            primaryClass: 'ENGINE',
            secondaryClasses: ['PERCEPTION'],
            evidence: [`metrics.deathEvents=${metrics.deathEvents}`, `metrics.combatEvidence=0`],
            suggestedFix:
                'Likely game engine NPC aggro or world hazard not surfaced by combat events; check RuneJS combat plugin for passive damage events not emitted via gateway',
        });
    }

    // Compute class counts
    const classCounts = Object.fromEntries(FAILURE_CLASSES.map(c => [c, 0])) as Record<FailureClass, number>;
    for (const obs of observations) {
        classCounts[obs.primaryClass] += 1;
    }

    const totalObs = observations.length;
    const distinctPrimaries = FAILURE_CLASSES.filter(c => classCounts[c] > 0);
    const dominantClass =
        distinctPrimaries.length > 0
            ? (distinctPrimaries.reduce((a, b) => (classCounts[a] >= classCounts[b] ? a : b)) as FailureClass)
            : undefined;

    const axisSurface = (metrics.deathEvents ?? 0) === 0 && (metrics.safeAttackActions ?? 0) >= 3 && (metrics.bonesEvidence ?? 0) >= 1;
    const axisDiversity = (metrics.survivalActions ?? 0) >= 1 && (metrics.bonesEvidence ?? 0) >= 1 && (metrics.safeAttackActions ?? 0) >= 1;
    const axisYield = totalObs >= 5 && distinctPrimaries.length >= 3;

    const summary = buildSummary(observations, classCounts, axisSurface, axisDiversity, axisYield, input.resident);

    return { observations, classCounts, dominantClass, axisSurface, axisDiversity, axisYield, summary };
}

function buildSummary(
    observations: ExpHardObservation[],
    classCounts: Record<FailureClass, number>,
    axisSurface: boolean,
    axisDiversity: boolean,
    axisYield: boolean,
    resident = 'res:qa-survivor',
): string {
    const lines: string[] = [];
    lines.push(`# EXP-HARD-1 Classification Summary`);
    lines.push('');
    lines.push(`## Three-Axis Grading`);
    lines.push('');
    lines.push(`| Axis | Result | Criterion |`);
    lines.push(`|---|---|---|`);
    lines.push(`| Axis 1 — Surface success | ${axisSurface ? '✓ PASS' : '✗ FAIL'} | Survived 60m, ≥3 kills, ≥3 bones |`);
    lines.push(`| Axis 2 — Behavior diversity | ${axisDiversity ? '✓ PASS' : '✗ FAIL'} | Eat + bone-bury + safe attack all present |`);
    lines.push(`| Axis 3 — Failure yield | ${axisYield ? '✓ PASS' : '✗ FAIL'} | ≥5 observations, ≥3 distinct primary classes |`);
    lines.push('');
    lines.push(`## Observations by Primary Class`);
    lines.push('');
    for (const cls of FAILURE_CLASSES) {
        const count = classCounts[cls];
        if (count === 0) {
            continue;
        }
        lines.push(`### ${cls} (${count} observation${count !== 1 ? 's' : ''})`);
        lines.push('');
        for (const obs of observations.filter(o => o.primaryClass === cls)) {
            lines.push(`**${obs.observationId}** — ${obs.evidence.join('; ')}`);
            if (obs.secondaryClasses.length > 0) {
                lines.push(`  Secondary: ${obs.secondaryClasses.join(', ')}`);
            }
            lines.push(`  Suggested fix: ${obs.suggestedFix}`);
            lines.push('');
        }
    }
    lines.push(`## Resident Under Test`);
    lines.push('');
    lines.push(`\`${resident}\` — see EXP-HARD-1 spec for run parameters.`);
    lines.push('');
    lines.push(`Substrate-ready; live-verify PENDING (classification is post-run analysis only).`);
    return lines.join('\n');
}

function countStaleTargetFailures(entries: NamedCombatSoakLogEntry[]): number {
    return entries.filter(
        entry =>
            entry.result &&
            typeof entry.result === 'object' &&
            (entry.result as Record<string, unknown>).ok === false &&
            /target_not_found|target_moved|out_of_range/i.test(String((entry.result as Record<string, unknown>).reason ?? '')),
    ).length;
}

export interface ExpHardClassifierCliOptions {
    inputDir: string;
    outputDir: string;
}

export function parseExpHardClassifierArgs(argv: string[]): ExpHardClassifierCliOptions {
    const options: ExpHardClassifierCliOptions = {
        inputDir: '',
        outputDir: '',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--input' || arg === '--input-dir') {
            options.inputDir = argv[++i] ?? '';
        } else if (arg.startsWith('--input=')) {
            options.inputDir = arg.slice('--input='.length);
        } else if (arg === '--output' || arg === '--output-dir') {
            options.outputDir = argv[++i] ?? '';
        } else if (arg.startsWith('--output=')) {
            options.outputDir = arg.slice('--output='.length);
        }
    }
    if (!options.inputDir) {
        throw new Error('--input <dir> is required');
    }
    if (!options.outputDir) {
        options.outputDir = path.join(options.inputDir, 'classification');
    }
    return options;
}

export async function runExpHardClassifierCli(argv: string[]): Promise<number> {
    const options = parseExpHardClassifierArgs(argv);

    const artifactFiles = fs
        .readdirSync(options.inputDir)
        .filter(f => f.startsWith('named_combat_soak_') && f.endsWith('.json'))
        .map(f => path.join(options.inputDir, f));

    if (artifactFiles.length === 0) {
        process.stderr.write(`[exp-hard-classifier] no named_combat_soak_*.json in ${options.inputDir}\n`);
        return 1;
    }

    fs.mkdirSync(options.outputDir, { recursive: true });

    const allObservations: ExpHardObservation[] = [];
    let lastClassification: ExpHardClassification | undefined;

    for (const artifactPath of artifactFiles) {
        const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
        const entries = (Array.isArray(raw.entries) ? raw.entries : []) as NamedCombatSoakLogEntry[];
        const events = (Array.isArray(raw.events) ? raw.events : []) as Array<Record<string, unknown>>;
        const metrics = (typeof raw.metrics === 'object' && raw.metrics !== null ? raw.metrics : {}) as Record<string, number>;
        const catatonicLoopDetected = Boolean(raw.catatonicLoopDetected);
        const opts = typeof raw.options === 'object' && raw.options !== null ? (raw.options as Record<string, unknown>) : {};
        const durationMs = typeof opts.durationMs === 'number' ? opts.durationMs : 120_000;
        const resident = typeof opts.resident === 'string' ? opts.resident : 'res:qa-survivor';

        const classification = classifyExpHardRun({ entries, events, metrics, catatonicLoopDetected, durationMs, resident });
        allObservations.push(...classification.observations);
        lastClassification = classification;
    }

    if (!lastClassification) {
        return 1;
    }

    const classificationPath = path.join(options.outputDir, 'failure_classification.json');
    fs.writeFileSync(
        classificationPath,
        JSON.stringify({ schemaVersion: 1, observations: allObservations, classCounts: lastClassification.classCounts }, null, 2) + '\n',
    );

    const summaryPath = path.join(options.outputDir, 'summary.md');
    fs.writeFileSync(summaryPath, lastClassification.summary + '\n');

    process.stdout.write(`[exp-hard-classifier] wrote ${classificationPath}\n`);
    process.stdout.write(`[exp-hard-classifier] wrote ${summaryPath}\n`);
    process.stdout.write(
        `[exp-hard-classifier] ${allObservations.length} observations; axisSurface=${lastClassification.axisSurface} axisDiversity=${lastClassification.axisDiversity} axisYield=${lastClassification.axisYield}\n`,
    );
    return 0;
}

if (require.main === module) {
    runExpHardClassifierCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
