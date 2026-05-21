import { z } from 'zod';

const isoTimestampSchema = z.string().datetime({ offset: true });
const identitySchema = z.object({
    id: z.string().min(1),
    version: z.string().min(1),
});

export const benchmarkRunStatusSchema = z.enum(['passed', 'failed', 'timeout', 'error', 'cancelled']);
export const benchmarkRunModeSchema = z.enum(['scripted', 'autonomous']);
const evidenceActionAttemptSchema = z.object({
    requestId: z.string().min(1).optional(),
    actionKind: z.string().min(1),
    source: z.string().min(1).optional(),
    cause: z.string().min(1).optional(),
    ok: z.boolean().optional(),
    sparkModule: identitySchema.optional(),
});
const evidenceInferenceRequestSchema = z.object({
    requestId: z.string().min(1).optional(),
    cause: z.string().min(1).optional(),
    sparkModule: identitySchema.optional(),
});

export const benchmarkArtifactSchema = z
    .object({
        schemaVersion: z.literal(1),
        runId: z.string().min(1),
        task: identitySchema,
        module: identitySchema,
        mode: benchmarkRunModeSchema.default('scripted'),
        resident: z.string().min(1),
        modelProfile: z.string().min(1),
        commits: z
            .array(
                z.object({
                    repo: z.string().min(1),
                    sha: z.string().regex(/^[a-f0-9]{7,40}$/i),
                    branch: z.string().min(1).optional(),
                    dirty: z.boolean().optional(),
                }),
            )
            .min(1),
        startedAt: isoTimestampSchema,
        endedAt: isoTimestampSchema,
        durationMs: z.number().int().nonnegative(),
        status: benchmarkRunStatusSchema,
        score: z.number().min(0).max(1),
        metrics: z.record(z.number().finite()).default({}),
        evidence: z
            .object({
                actionAttemptIds: z.array(z.string().min(1)).optional(),
                actionAttempts: z.array(evidenceActionAttemptSchema).optional(),
                inferenceRequestIds: z.array(z.string().min(1)).optional(),
                inferenceRequests: z.array(evidenceInferenceRequestSchema).optional(),
                perceptionIds: z.array(z.string().min(1)).optional(),
                summaries: z.array(z.string().min(1)).optional(),
                artifactPaths: z.array(z.string().min(1)).optional(),
            })
            .default({}),
        failureReason: z.string().min(1).optional(),
        generatedAt: isoTimestampSchema,
    })
    .superRefine((artifact, context) => {
        const started = Date.parse(artifact.startedAt);
        const ended = Date.parse(artifact.endedAt);
        if (Number.isFinite(started) && Number.isFinite(ended) && ended < started) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'endedAt must be at or after startedAt',
                path: ['endedAt'],
            });
        }
        if (artifact.status !== 'passed' && !artifact.failureReason) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'failureReason is required when status is not passed',
                path: ['failureReason'],
            });
        }
    });

export type BenchmarkArtifact = z.infer<typeof benchmarkArtifactSchema>;
export type BenchmarkRunStatus = z.infer<typeof benchmarkRunStatusSchema>;
export type BenchmarkRunMode = z.infer<typeof benchmarkRunModeSchema>;

export function normalizeBenchmarkArtifact(candidate: unknown): BenchmarkArtifact {
    if (!candidate || typeof candidate !== 'object') {
        return benchmarkArtifactSchema.parse(candidate);
    }

    const mutable = { ...(candidate as Record<string, unknown>) };
    const startedAt = typeof mutable.startedAt === 'string' ? Date.parse(mutable.startedAt) : NaN;
    const endedAt = typeof mutable.endedAt === 'string' ? Date.parse(mutable.endedAt) : NaN;

    if (typeof mutable.durationMs !== 'number' && Number.isFinite(startedAt) && Number.isFinite(endedAt)) {
        mutable.durationMs = Math.max(0, endedAt - startedAt);
    }
    if (typeof mutable.generatedAt !== 'string') {
        mutable.generatedAt = typeof mutable.endedAt === 'string' ? mutable.endedAt : new Date().toISOString();
    }

    return benchmarkArtifactSchema.parse(mutable);
}
