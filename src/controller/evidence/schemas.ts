import { z } from 'zod';

export const EVIDENCE_SCHEMA_VERSION = 1;

export const endTickReasonSchema = z.union([
    z.literal('legacy_complete'),
    z.literal('attention_exhausted'),
    z.literal('plan_continuation'),
    z.literal('hook_noop'),
    z.string().regex(/^budget_exhausted:[a-z0-9_-]+$/),
    z.literal('parse_failed'),
    z.literal('legacy_complete_post_action'),
    z.literal('tick_complete'),
]);

export const trajectoryLineKindSchema = z.enum([
    'begin_tick',
    'end_tick',
    'hook',
    'budget',
    'plan',
    'decision',
    'action',
    'action_result',
    'legacy_event',
    'say',
    'patron',
    'moment',
    'error',
]);

export const trajectoryLineSchema = z
    .object({
        schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
        ts: z.string().datetime(),
        tick: z.number().int().nonnegative(),
        sessionId: z.string().min(1),
        kind: trajectoryLineKindSchema,
    })
    .passthrough()
    .superRefine((line, context) => {
        if (line.kind !== 'end_tick') {
            return;
        }
        const parsed = endTickReasonSchema.safeParse(line.reason);
        if (!parsed.success) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['reason'],
                message: 'Invalid end_tick reason',
            });
        }
    });

export const progressLineSchema = z
    .object({
        schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
        ts: z.string().datetime(),
        tick: z.number().int().nonnegative(),
        sessionId: z.string().min(1),
        kind: z.literal('progress'),
        meaningful: z.boolean(),
        reasons: z.array(z.string()),
        stuckSince: z.number().int().nonnegative().nullable(),
    })
    .passthrough();

export const evidenceIndexSchema = z.object({
    schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
    resident: z.string().min(1),
    currentSessionId: z.string().min(1).optional(),
    sessions: z.array(
        z.object({
            sessionId: z.string().min(1),
            soulVersion: z.string().min(1),
            startedAt: z.string().datetime(),
            endedAt: z.string().datetime().optional(),
            endReason: z.enum(['shutdown', 'crash', 'logout']).optional(),
            trajectoryPath: z.string().min(1),
            progressPath: z.string().min(1),
            status: z.enum(['active', 'ended']),
        }),
    ),
});

export type TrajectoryLine = z.infer<typeof trajectoryLineSchema>;
export type ProgressLine = z.infer<typeof progressLineSchema>;
export type EvidenceIndex = z.infer<typeof evidenceIndexSchema>;
export type EvidenceSessionIndexEntry = EvidenceIndex['sessions'][number];
export type EndTickReason = z.infer<typeof endTickReasonSchema>;
