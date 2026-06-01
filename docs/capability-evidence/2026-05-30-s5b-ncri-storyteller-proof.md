# S5b NCRI Storyteller Proof

Date: 2026-05-30
Owner: Codex

## Claim

Resident-originated NCRI transfer and redemption events now retain the source resident, flow into the Storyteller dry-run digest, and produce a reviewable dispatch artifact without a paid model call.

## Why This Mattered

The dashboard D6 print/NCRI panel can warn when NCRI activity is not represented in Storyteller canon. Before this pass, the NCRI economy events reached the digest but resident-owned transfers could be attributed to `unknown`, which made the Library/Storyteller link weaker than the actual gameplay loop.

## Evidence

- Red test: `npm test -- --runInBand src/controller/storyteller/cli.test.ts` failed because `result.digest.residents` was empty for a resident-owned NCRI transfer.
- Fix: `NcriRegistry` now stores optional `sourceResidentName` when an NCRI starts with a resident owner and emits that resident on `ncri_sale` and `ncri_redemption` economy events.
- Focused tests: `npm test -- --runInBand src/controller/storyteller/cli.test.ts src/controller/ncri/ncri-registry.test.ts` passed `35/35`.
- CLI smoke: generated `data/controller/storyteller/s5b-ncri-proof-20260530T0920/digest.json` from a resident-owned Kindling Relic transfer and redemption.
- Storyteller run smoke: `npm run storyteller:run -- --digest-id s5b-ncri-proof-20260530T0920` wrote `dispatch.json` with `needsReview: true` because no `STORYTELLER_LLM_BASE_URL` was configured, so no paid model was called.

## Artifact Summary

Digest: `s5b-ncri-proof-20260530T0920`

- `ncriEvents`: 2
- Resident snapshot: `res:duke`
- Top events:
  - `ncri_created` attributed to `res:duke`
  - `ncri_redeemed` attributed to `res:duke`
- Event count summary includes `NCRI events: 2`

## Remaining Work

- Wire a real resident-obtained NCRI item path into ordinary gameplay once S3/S5 operator flows are ready.
- Run a configured Storyteller model profile over the digest after cost caps are explicitly set.
- Add dashboard browser proof with live controller data once a real NCRI exchange exists.
