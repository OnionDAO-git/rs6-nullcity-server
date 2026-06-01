# S0a AP/GP Copy Scan Refresh (2026-05-30)

Packet: `S0a`  
Date: `2026-05-30`  
Scope: classify remaining `Shards` mentions as historical, legacy/internal alias, or active public copy.

## Commands Run

- `rg -n "Shards" /Users/james/Code/OnionDAO/rs6-nullcity-server`
- `rg -n "Shards" src/controller --glob '!**/*.test.ts'`
- `rg -n "'Shards'|\"Shards\"" src/controller --glob '!**/*.test.ts'`
- `rg -n "Shards" docs`

## Classification Summary

- Total `Shards` hits in repo: `217`.
- `src/controller` non-test hits: `18`.
- Runtime/user-facing string literals in non-test controller code: `0`.
  - The only quoted `"Shards"` hit in non-test code is a historical comment in `currency-ledger.ts`.
- Source-of-truth docs (`roadmap`, `weekend implementation plan`, `issue register`, `resident capabilities`, `sprint plan`) use `Shards` only as historical context or prior-evidence quoting.

## Category Buckets

1. Historical evidence and timeline records:
   - `docs/agent-status.md`, historical sprint handoffs/specs, older readiness/runbook snapshots.
   - Benchmark/result docs quoting prior output.
2. Legacy/internal alias comments:
   - Controller comments in patron/trading/library modules describing pre-AP behavior or migration context.
   - Test fixtures validating backward compatibility of old `patron-currency.json` reason text.
3. Active public copy:
   - None found in current non-test controller runtime strings.

## Result

S0a classification gate passes on this refresh: AP/Attention Points remains the active public naming, while `Shards` references are historical or internal compatibility notes.
