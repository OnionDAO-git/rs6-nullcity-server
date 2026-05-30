/**
 * S-DEMO-P0-1 (QA-20260530-018): best-effort recovery of the request id from
 * a frame whose schema validation failed. `JSON.parse` can still succeed on
 * a frame whose `payload` violates the typed schema (e.g. missing/extra
 * field), which is the common case we care about — we want to bounce a
 * typed error frame back with `request_id` set so the controller's pending
 * promise resolves immediately rather than waiting for its 10s timeout to
 * fire (the exact `Gateway request timed out: burn_resident_gold` symptom
 * captured in QA-20260530-018).
 *
 * Lives in its own module so the unit tests can exercise the helper
 * without dragging the engine import chain (world/chokidar/etc.) into
 * Jest's transformation pipeline.
 */
export function recoverRequestId(raw: unknown): string | number | undefined {
    try {
        const text =
            typeof raw === 'string'
                ? raw
                : Buffer.isBuffer(raw)
                  ? raw.toString('utf8')
                  : Array.isArray(raw)
                    ? Buffer.concat(raw as Buffer[]).toString('utf8')
                    : String(raw);
        const parsed = JSON.parse(text) as { id?: unknown };
        if (typeof parsed?.id === 'string' || typeof parsed?.id === 'number') {
            return parsed.id;
        }
    } catch {
        // intentional swallow — recovery is best-effort
    }
    return undefined;
}
