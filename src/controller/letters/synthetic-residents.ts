import { residentSlug } from '../memory/runtime-state';

/**
 * Shared predicate for residents that must be hidden from public-facing
 * surfaces (HR-7, extends S-WALL-FILTER-1): benchmark synthetics, soak/QA
 * harness artifacts, and verification residents that share the resident
 * namespace with the real cast (~595 such directories observed in live
 * memory roots). Applied consistently across:
 *
 *   - letters wall snapshot (roster, letters, deathsToday) — wall-snapshot.ts
 *   - GET /v1/library + /v1/patron/residents             — wall-snapshot.ts
 *   - GET /v1/graveyard                                   — wall-snapshot.ts
 *   - epitaph/broadcast letter dispatch on death          — resident-runtime.ts
 *   - storyteller digest (residents, goals, events)       — storyteller/cli.ts
 *
 * CONSERVATIVE BY DESIGN (launch decision 2026-06-11): only clear test
 * patterns are filtered. The `qa-*` roster residents (qa-cook,
 * qa-woodcutter, qa-guardian, ...) are the LIVE CAST and must NOT be
 * filtered — this reverses the earlier blanket `res-qa-*` exclusion.
 * Canonical demo souls like `res-agent` are also real, not fixtures.
 *
 * Matched patterns (slug form):
 *   - res-bmk_*          benchmark runner synthetics (benchmark-runner.ts)
 *   - res-e2e-*          end-to-end test residents
 *   - res-restart-test*  restart verification artifacts
 *   - res-wf-verify*     workflow verification (wf-verify-born, wf-verify-*)
 *   - res-loop-check / res-smoke-born / res-death-test / res-verify-born
 *   - *-smoke            smoke-test suffix convention (e.g. patron-loop-smoke)
 */
export const SYNTHETIC_SLUG_PATTERN = /^res-(bmk_|e2e-|loop-check|smoke-born|wf-verify|death-test|restart-test|verify-born)|-smoke$/;

/** True when a resident directory slug (e.g. "res-bmk_x") is a test artifact. */
export function isSyntheticSlug(slug: string): boolean {
    return SYNTHETIC_SLUG_PATTERN.test(slug);
}

/**
 * True when a resident is a test artifact, accepting either the colon
 * resident-name form (`res:bmk_x`, as in Letter.senderResident) or the
 * directory-slug form (`res-bmk_x`).
 */
export function isSyntheticResident(nameOrSlug: string): boolean {
    return isSyntheticSlug(residentSlug(nameOrSlug));
}
