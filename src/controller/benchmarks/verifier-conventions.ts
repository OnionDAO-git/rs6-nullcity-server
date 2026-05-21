import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { BenchmarkArtifact } from './benchmark-artifact';

const MARKER_START = '__REWARD_JSON_START__';
const MARKER_END = '__REWARD_JSON_END__';

export const failureReasonSchema = z.enum([
    'none',
    'timeout',
    'exception',
    'goal_not_met',
    'died',
    'budget_exhausted',
    'kernel_aborted',
    'unknown',
]);

export const rewardSchema = z.object({
    value: z.number().finite(),
    unit: z.literal('score'),
    taskId: z.string().min(1),
    runId: z.string().min(1),
    moduleId: z.string().min(1),
    moduleVersion: z.string().min(1),
    samples: z.array(z.unknown()).optional(),
    failure_reason: failureReasonSchema,
});

export type FailureReason = z.infer<typeof failureReasonSchema>;
export type Reward = z.infer<typeof rewardSchema>;

export interface EmitVerifierConventionsOptions {
    artifact: BenchmarkArtifact;
    outputDir: string;
    stdout?: (text: string) => void;
    failureReason?: FailureReason;
}

export interface EmitVerifierConventionsResult {
    reward: Reward;
    rewardJsonPath: string;
    rewardTxtPath: string;
    evidenceArtifactPaths: string[];
}

export function classifyFailureReason(artifact: BenchmarkArtifact): FailureReason {
    if (artifact.status === 'passed') {
        return 'none';
    }
    if (artifact.status === 'timeout') {
        return 'timeout';
    }

    const text = `${artifact.status} ${artifact.failureReason || ''}`.toLowerCase();
    if (/\bdeath\b|\bdead\b|\bdied\b/.test(text)) {
        return 'died';
    }
    if (/\bbudget\b/.test(text)) {
        return 'budget_exhausted';
    }
    if (/\babort(?:ed)?\b|\bcancel(?:led|ed)?\b/.test(text)) {
        return 'kernel_aborted';
    }
    if (artifact.status === 'error') {
        return 'exception';
    }
    if (artifact.status === 'failed') {
        return 'goal_not_met';
    }

    return 'unknown';
}

export function buildReward(artifact: BenchmarkArtifact, failureReason = classifyFailureReason(artifact)): Reward {
    return rewardSchema.parse({
        value: artifact.score,
        unit: 'score',
        taskId: artifact.task.id,
        runId: artifact.runId,
        moduleId: artifact.module.id,
        moduleVersion: artifact.module.version,
        failure_reason: failureReason,
    });
}

export function emitVerifierConventions(options: EmitVerifierConventionsOptions): EmitVerifierConventionsResult {
    const reward = buildReward(options.artifact, options.failureReason);
    const resolved = path.resolve(process.cwd(), options.outputDir);
    fs.mkdirSync(resolved, { recursive: true });

    const rewardJsonPath = path.join(resolved, 'reward.json');
    const rewardTxtPath = path.join(resolved, 'reward.txt');
    fs.writeFileSync(rewardJsonPath, `${JSON.stringify(reward, null, 2)}\n`);
    fs.writeFileSync(rewardTxtPath, `${reward.value}\n`);
    const evidenceArtifactPaths = copyEvidenceArtifacts(options.artifact, resolved);

    options.stdout?.(`${MARKER_START}\n${JSON.stringify(reward)}\n${MARKER_END}\n`);

    return { reward, rewardJsonPath, rewardTxtPath, evidenceArtifactPaths };
}

function copyEvidenceArtifacts(artifact: BenchmarkArtifact, outputDir: string): string[] {
    const copies: string[] = [];
    for (const sourcePath of artifact.evidence.artifactPaths || []) {
        if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            continue;
        }
        const destinationPath = path.join(outputDir, 'evidence', evidenceArtifactKind(sourcePath), path.basename(sourcePath));
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
        copies.push(destinationPath);
    }
    return copies;
}

function evidenceArtifactKind(sourcePath: string): string {
    const parent = path.basename(path.dirname(sourcePath));
    if (sourcePath.split(path.sep).includes('library')) {
        return 'library';
    }
    return parent === 'trajectory' || parent === 'progress' ? parent : 'artifacts';
}
