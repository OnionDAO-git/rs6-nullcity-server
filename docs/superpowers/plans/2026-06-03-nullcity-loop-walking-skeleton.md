# Null City Loop — Walking Skeleton (in-our-control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to implement this plan task-by-task. Steps use `- [ ]` checkboxes. **Verify before claiming done** (`superpowers:verification-before-completion`): a step is done only when its exact run command shows the expected output.

**Goal:** Build the in-our-control half of the patron loop — identity resolution, a real intent-tracked "Support" flow (with a labelled non-production spend stand-in), and the Shards-free thank-you-letter/standing seam — so "spend → resident attention rises → patron gets a letter" is provable end-to-end on our side, before Dev's consent-spend API lands.

**Architecture:** Landing `users.id` is the canonical `personId`. The dashboard BFF resolves `cityUserId→personId` (link already exists) and `personId→patronHandle` (new alias table). A new BFF saga (`attention_grant_intents`) debits a **clearly-labelled stand-in** ledger (swappable for Dev's real API later) and calls the existing City `creditAttention`. On the server, a new Shards-free `recordSettledSupport` seam (modeled on `PatronGateway.witnessAt`, which already does standing+letters with no currency debit) fires on credit, reusing the already-built letters/standing machinery.

**Tech Stack:** Dashboard `packages/server` = Bun + `bun:test`, Postgres via `BunSql`, hand-rolled migrations (`cityMigrations` array). Server = TypeScript + Jest (ts-jest), file-backed stores.

---

## Overnight execution protocol (read first)

**Scope (HARD boundary):** only the 4 tasks below. They are fully in-our-control: no Dev API, no landing writes, **no `resident-runtime.ts` edits** (the file the other agent and Codex own — we don't touch it, so no `[>]` lock needed from us). If a task tempts you outside this boundary, **stop and log it** (see "When to stop").

**Order:** Task 1 (identity) → Task 2 (support skeleton) → Task 3 (letter seam) → Task 4 (integration capstone). Tasks 1–3 are independently unit-testable; Task 4 wires them into the walking skeleton.

**Isolation (create worktrees at execution start, not before — avoids drift):**
```bash
# server repo
git -C /Users/james/Code/OnionDAO/rs6-nullcity-server fetch origin agents/wip --quiet
git -C /Users/james/Code/OnionDAO/rs6-nullcity-server worktree add /Users/james/Code/OnionDAO/.worktrees/loop-server -b loop/walking-skeleton-server origin/agents/wip
# dashboard repo
git -C /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard fetch origin main --quiet
git -C /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard worktree add /Users/james/Code/OnionDAO/.worktrees/loop-dashboard -b loop/walking-skeleton-dashboard origin/main
```
Work in those worktrees; `bun install`/deps already resolved in the parent checkouts (Bun/jest run against source). Integrate to the default branch (`agents/wip` / `main`) at the end of each task via the isolated-worktree push method already proven for the design doc (cherry-pick/copy only your task's files; **never `git add -A`, never `--amend`** — the shared checkouts carry other agents' WIP).

**Guardrails (from prior overnight runs + repo rules):**
- **Tests are the contract.** A task is "done right" only when its acceptance-criteria tests pass via the exact commands listed. No "looks correct."
- **Stage explicit file lists only.** Both repos have unrelated WIP; `git add <explicit paths>`.
- **No live-stack restarts** (Codex/runtime-steward owns those). Unit tests need no restart. Anything requiring a running controller/game = write the code + unit test, then **queue it** for the steward, don't restart.
- **No product decisions invented.** If you hit a fork that's James's or Dev's, stop that thread and log it.
- **Push direct to default branch** per repo convention (`agents/wip`, `main`) — no long-lived feature branches beyond the integration worktree.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

**When to stop (and leave a note in the run log, §Run Log):**
- A task's tests can't be made to pass after a genuine attempt → log the blocker, move to the next independent task.
- You'd need to touch `resident-runtime.ts`, restart the stack, or call a Dev/landing endpoint → out of scope, log + queue.
- A decision belongs to James/Dev → log it under "Decisions waiting."

**Morning deliverable:** committed, test-passing progress on as many of the 4 tasks as cleanly land; a Run Log (§ at bottom) showing per-task status, what's queued for the steward (live verification), and any decisions waiting.

---

## File structure (what gets created/modified)

**Dashboard** (`rs6-nullcity-residents-dashboard/packages/server/src/city/`):
- `migrations/schema.ts` — append `002_city_identity_aliases` + `003_attention_grant_intents`.
- `store.ts` (interface + factory), `memory-store.ts` (class), `postgres-store.ts` — add identity + intent methods to all three `CityStore` impls.
- `nullcity-control.ts` — add `creditAttention` client method + types + guard.
- `attention-grant.ts` (new) — the saga orchestrator.
- `routes.ts` — route calls the orchestrator.
- Tests: `identity.test.ts` (new), `attention-grant.test.ts` (new), `nullcity-control.test.ts`, `routes.test.ts`.

**Server** (`rs6-nullcity-server/src/controller/`):
- `patron/settled-support.ts` (new) — `recordSettledSupport`.
- `city-integration/service.ts` — accept optional `personId`; inject `standingLedger`/`lettersStore`; fire seam in `creditAttention`.
- `city-integration/economy-event.ts` — optional `personId` field.
- `controller-host.ts` — hoist `LettersStore`, inject into `CityIntegrationService`.
- Tests: `patron/settled-support.test.ts` (new), `city-integration/service.test.ts`.

None of these is `resident-runtime.ts`.

---

## Task 1: Identity layer (`personId` / alias map) — T0.ID

**Repo/runner:** Dashboard part = `bun test` (from repo root). Server part = `npx jest`.
`personId ≡ landing users.id ≡ city_users.landing_user_id`. The `cityUserId→landing_user_id` link exists (`migrations/schema.ts:15-24`); this adds `resolveOnionId` + a `personId→patronHandle` alias table + a server-side optional `personId` pass-through.

**Files:**
- Modify: `packages/server/src/city/store.ts` (interface ~:124, factory ~:158-578), `memory-store.ts` (class ~:42-490), `postgres-store.ts` (~:485), `migrations/schema.ts` (append after :265)
- Test: Create `packages/server/src/city/identity.test.ts`
- Modify (server): `src/controller/city-integration/service.ts` (:199-208, :977-1022), `economy-event.ts` (:45,:70,:117); Test `src/controller/city-integration/service.test.ts`

- [ ] **Step 1 — Failing test (dashboard, in-memory).** Create `packages/server/src/city/identity.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { InMemoryCityStore } from './memory-store';
import type { LandingSessionUser } from './types';

const landingUser: LandingSessionUser = {
  id: 'landing-user-1', email: 'alice@example.com', name: 'Alice Example',
  handle: 'alice', avatarUrl: null, isAdmin: false, profileClaimed: true,
};

describe('resolveOnionId', () => {
  test('returns the landing_user_id (personId) for a known cityUserId', async () => {
    const store = new InMemoryCityStore({ now: () => '2026-06-03T00:00:00.000Z', id: () => 'city-user-1' });
    const cityUser = await store.upsertUserFromLanding(landingUser);
    expect(await store.resolveOnionId(cityUser.id)).toBe('landing-user-1');
  });
  test('throws 404 for an unknown cityUserId', async () => {
    const store = new InMemoryCityStore();
    await expect(store.resolveOnionId('missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('identity aliases (personId -> patronHandle)', () => {
  test('setIdentityAlias then resolvePatronHandle round-trips', async () => {
    const store = new InMemoryCityStore({ now: () => '2026-06-03T00:00:00.000Z', id: () => 'city-user-1' });
    await store.upsertUserFromLanding(landingUser);
    await store.setIdentityAlias('landing-user-1', 'alice');
    expect(await store.resolvePatronHandle('landing-user-1')).toBe('alice');
  });
  test('resolvePatronHandle returns undefined when no alias exists', async () => {
    expect(await new InMemoryCityStore().resolvePatronHandle('landing-user-1')).toBeUndefined();
  });
  test('setIdentityAlias upserts the handle', async () => {
    const store = new InMemoryCityStore({ now: () => '2026-06-03T00:00:00.000Z', id: () => 'city-user-1' });
    await store.upsertUserFromLanding(landingUser);
    await store.setIdentityAlias('landing-user-1', 'alice');
    await store.setIdentityAlias('landing-user-1', 'alice-2');
    expect(await store.resolvePatronHandle('landing-user-1')).toBe('alice-2');
  });
});
```
Run: `bun test packages/server/src/city/identity.test.ts` → Expected: FAIL (methods undefined).

- [ ] **Step 2 — Extend `CityStore` interface** (`store.ts`, before closing `}` ~:124):
```ts
  resolveOnionId(cityUserId: string): Promise<string>; // personId === landing users.id
  setIdentityAlias(personId: string, patronHandle: string): Promise<void>;
  resolvePatronHandle(personId: string): Promise<string | undefined>;
```

- [ ] **Step 3 — Implement in `InMemoryCityStore`** (`memory-store.ts`). Field near :64: `private readonly identityAliases = new Map<string, string>();`. Methods (after `listLibrarySoulLives` ~:473):
```ts
  async resolveOnionId(cityUserId: string): Promise<string> { return this.requireUser(cityUserId).landingUserId; }
  async setIdentityAlias(personId: string, patronHandle: string): Promise<void> { this.identityAliases.set(personId, patronHandle); }
  async resolvePatronHandle(personId: string): Promise<string | undefined> { return this.identityAliases.get(personId); }
```
Run: `bun test packages/server/src/city/identity.test.ts` → in-memory tests PASS (migration test added next).

- [ ] **Step 4 — Failing migration test + migration.** Append to `identity.test.ts`:
```ts
import { cityMigrations } from './migrations/schema';
describe('city_identity_aliases migration', () => {
  test('002 migration creates the table with person_id PK', () => {
    const m = cityMigrations.find(x => x.id === '002_city_identity_aliases');
    expect(m).toBeDefined();
    expect(m!.sql).toContain('CREATE TABLE IF NOT EXISTS city_identity_aliases');
    expect(m!.sql).toContain('person_id TEXT PRIMARY KEY');
    expect(m!.sql).toContain('patron_handle TEXT NOT NULL');
  });
});
```
Run → FAIL. Then append to `cityMigrations` in `migrations/schema.ts` (before closing `]`):
```ts
  {
    id: '002_city_identity_aliases',
    sql: `
CREATE TABLE IF NOT EXISTS city_identity_aliases (
  person_id TEXT PRIMARY KEY,
  patron_handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_city_identity_aliases_handle ON city_identity_aliases(patron_handle);
`.trim(),
  },
```
Run → PASS.

- [ ] **Step 5 — Implement in `PostgresCityStore`** (`postgres-store.ts`, near `requireUser` ~:485), using `this.sql` + `stringField` (~:538) + `CityStoreError` (~:5):
```ts
  async resolveOnionId(cityUserId: string): Promise<string> {
    const rows = await this.sql`SELECT landing_user_id FROM city_users WHERE id = ${cityUserId}`;
    if (!rows[0]) throw new CityStoreError('City user not found', 404);
    return stringField(rows[0], 'landing_user_id');
  }
  async setIdentityAlias(personId: string, patronHandle: string): Promise<void> {
    await this.sql`INSERT INTO city_identity_aliases (person_id, patron_handle) VALUES (${personId}, ${patronHandle})
      ON CONFLICT (person_id) DO UPDATE SET patron_handle = EXCLUDED.patron_handle, updated_at = now()`;
  }
  async resolvePatronHandle(personId: string): Promise<string | undefined> {
    const rows = await this.sql`SELECT patron_handle FROM city_identity_aliases WHERE person_id = ${personId}`;
    return rows[0] ? stringField(rows[0], 'patron_handle') : undefined;
  }
```

- [ ] **Step 6 — Implement in `createInMemoryCityStore` factory** (`store.ts:158`). `const identityAliases = new Map<string, string>();` near :174; methods on the `store` object (after `listLibrarySoulLives` ~:577) using `requireUser(...).landingUserId`.

- [ ] **Step 7 — Verify (catches all 3 impls).**
Run: `bun test packages/server/src/city/identity.test.ts` → PASS · `bun test packages/server/src/city/` → no regressions · `cd packages/server && bun run typecheck` → clean.

- [ ] **Step 8 — Server part: optional `personId` pass-through (jest).** Failing test in `src/controller/city-integration/service.test.ts` (mirror :108-133/:417):
```ts
it('stamps personId on the ap_topup event and timeline when provided', async () => {
  await service.creditAttention('res:test', { idempotencyKey: 'ap-pid-1', amount: 25, cityUserId: 'user-1', personId: 'landing-user-1', sourceType: 'patron_checkin', sourceId: 'checkin-9' });
  const topup = new EconomyEventLog(root).readAll().find(e => e.kind === 'ap_topup');
  expect(topup).toMatchObject({ kind: 'ap_topup', cityUserId: 'user-1', personId: 'landing-user-1', apDelta: 25 });
});
```
Run: `npx jest --coverage=false src/controller/city-integration/service.test.ts -t "stamps personId"` → FAIL (`.strict()` rejects `personId`).
Then: add `personId: z.string().min(1).optional(),` to `attentionGrantRequestSchema` (:199-208); add optional `personId` to `EconomyEvent` interface (:45), `economyEventSchema` (:70), and the `append()` spread (:117) in `economy-event.ts`; stamp `personId: request.personId` in `creditAttention`'s library event (~:1004) and `ap_topup` append (~:1011) in `service.ts`.
Run: `npx jest --coverage=false src/controller/city-integration/service.test.ts` and `... economy-event.test.ts` → PASS (the "12 kinds" test is unaffected; `personId` is a field, not a kind).

- [ ] **Step 9 — Commit (two repos, explicit files).**
Dashboard: `git add packages/server/src/city/{store.ts,memory-store.ts,postgres-store.ts,migrations/schema.ts,identity.test.ts}` → commit `feat(city): resolveOnionId + city_identity_aliases (personId→patronHandle)`.
Server: `git add src/controller/city-integration/{service.ts,economy-event.ts,service.test.ts}` → commit `feat(city-integration): pass personId through creditAttention to ap_topup + timeline`.

**Acceptance:** `resolveOnionId` returns landing_user_id (404 unknown); `002` migration creates `city_identity_aliases(person_id PK, patron_handle, unique handle)`; alias set/resolve round-trips + upserts; all 3 store impls typecheck; server stamps `personId` when provided, optional otherwise, no regressions.

---

## Task 2: Support skeleton + `attention_grant_intents` saga — T0.0a

**Repo/runner:** Dashboard, `bun test` (from `packages/server/`). Replaces the `mocked:true` `grantResidentAttention` with a real intent-tracked saga that debits a **labelled non-production stand-in** and calls City `creditAttention`. No real landing spend.

**Files:** Create `packages/server/src/city/attention-grant.ts` + `attention-grant.test.ts`; modify `migrations/schema.ts`, `nullcity-control.ts` (+`.test.ts`), `store.ts`, `memory-store.ts`, `postgres-store.ts`, `routes.ts` (+`.test.ts`).

- [ ] **Step 1 — Intents migration (failing test first).** In `routes.test.ts` "city migration SQL" test (~:61) add table `'attention_grant_intents'`; assert `cityMigrations` contains `003_attention_grant_intents`. Run `bun test src/city/routes.test.ts -t "city migration SQL"` → FAIL. Add migration to `schema.ts`:
```ts
  {
    id: '003_attention_grant_intents',
    sql: `
CREATE TABLE IF NOT EXISTS attention_grant_intents (
  id TEXT PRIMARY KEY,
  city_user_id TEXT NOT NULL REFERENCES city_users(id) ON DELETE CASCADE,
  resident_id TEXT NOT NULL,
  ap_amount INTEGER NOT NULL CHECK (ap_amount > 0),
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created','debited','sent_to_city','settled','failed')),
  standin_ledger_entry_id TEXT REFERENCES point_ledger_entries(id) ON DELETE RESTRICT,
  city_response JSONB,
  failure_reason TEXT,
  -- NON-PRODUCTION: standin_ledger_entry_id debits the BFF projection point_accounts,
  -- a labelled stand-in for Dev's consent-spend API (not yet available).
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_attention_grant_intents_city_user_created ON attention_grant_intents(city_user_id, created_at DESC);
`.trim(),
  },
```
Run → PASS.

- [ ] **Step 2 — `creditAttention` client method (failing test).** Add to `nullcity-control.test.ts` (mirror its fetch-swap pattern :1-9):
```ts
test('credits resident attention with bearer auth and amount field', async () => {
  const calls: any[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), method: init?.method, authorization: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true, resident: 'res:fern', attentionBefore: 10, attentionAfter: 35, creditedAmount: 25 }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = createNullCityControlClient({ baseUrl: 'http://controller.test/api/nullcity', token: 'city-token' });
  const result = await client.creditAttention!('res:fern', { idempotencyKey: 'att-1', amount: 25, cityUserId: 'city-user-1', sourceType: 'resident_attention_grant', sourceId: 'att-1' });
  expect(calls[0]).toEqual({ url: 'http://controller.test/api/nullcity/residents/res:fern/attention-grants', method: 'POST', authorization: 'Bearer city-token', body: { idempotencyKey: 'att-1', amount: 25, cityUserId: 'city-user-1', sourceType: 'resident_attention_grant', sourceId: 'att-1' } });
  expect(result).toMatchObject({ ok: true, attentionAfter: 35, creditedAmount: 25 });
});
```
Run `bun test src/city/nullcity-control.test.ts -t "credits resident attention"` → FAIL. Then in `nullcity-control.ts`: add `NullCityCreditAttentionRequest`/`Result` types (~:197), `creditAttention?(...)` to the interface (~:207), the impl mirroring `exchangeApForGp` (after :307), and a `parseCreditAttention` guard (~:382). **Field is `amount` not `apAmount`; City schema is `.strict()` — send only the allowed keys.** Run → PASS.

- [ ] **Step 3 — Intent persistence methods.** Add to `store.ts` interface (~:118) + types (~:132): `AttentionGrantIntent`, `AttentionGrantIntentState = 'created'|'debited'|'sent_to_city'|'settled'|'failed'`, `createAttentionGrantIntent`, `getAttentionGrantIntent`, `updateAttentionGrantIntent` (full type bodies per the T0.0a spec). Implement in `memory-store.ts` (Map keyed `${cityUserId}:${idempotencyKey}`, idempotent create returns existing) and `postgres-store.ts` (`INSERT ... ON CONFLICT (city_user_id, idempotency_key) DO NOTHING` then SELECT; `UPDATE ... updated_at=now()`). Unit-test the memory impl directly in `attention-grant.test.ts`.

- [ ] **Step 4 — The saga orchestrator (core acceptance test).** `attention-grant.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { InMemoryCityStore } from './memory-store';
import { runAttentionGrant } from './attention-grant';
import type { NullCityControlClient } from './nullcity-control';

function fakeControl(spy: { calls: any[] }) {
  return { creditAttention: async (resident: string, body: any) => { spy.calls.push({ resident, body }); return { ok: true, resident, attentionBefore: 0, attentionAfter: body.amount, creditedAmount: body.amount }; } } as Pick<NullCityControlClient, 'creditAttention'>;
}
describe('runAttentionGrant', () => {
  test('approved support: intent + stand-in debit + creditAttention + settled', async () => {
    const store = new InMemoryCityStore();
    const cityUser = await store.upsertUserFromLanding({ id:'l1', email:'a@b.c', name:'A', handle:'a', avatarUrl:null, isAdmin:false, profileClaimed:true });
    await store.appendPointLedger({ cityUserId: cityUser.id, resource:'AP', delta:750, sourceType:'seed', sourceId:'s1' });
    const spy = { calls: [] as any[] };
    const result = await runAttentionGrant({ store, control: fakeControl(spy) as NullCityControlClient }, { cityUserId: cityUser.id, residentId: 'res:fern', apAmount: 125, idempotencyKey: 'att-1' });
    expect((result as any).mocked).toBeUndefined();
    expect(result.intent.state).toBe('settled');
    expect(result.intent.standinLedgerEntryId).toBeDefined();
    expect(result.ledger.delta).toBe(-125);
    expect(result.ledger.metadata).toMatchObject({ standin: true, nonProduction: true });
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toMatchObject({ resident: 'res:fern', body: { amount: 125, idempotencyKey: 'att-1' } });
  });
  test('idempotent under repeated key: debit once, one intent, one city call', async () => {
    const store = new InMemoryCityStore();
    const cityUser = await store.upsertUserFromLanding({ id:'l1', email:'a@b.c', name:'A', handle:'a', avatarUrl:null, isAdmin:false, profileClaimed:true });
    await store.appendPointLedger({ cityUserId: cityUser.id, resource:'AP', delta:750, sourceType:'seed', sourceId:'s1' });
    const spy = { calls: [] as any[] };
    const args = { cityUserId: cityUser.id, residentId: 'res:fern', apAmount: 125, idempotencyKey: 'att-1' };
    await runAttentionGrant({ store, control: fakeControl(spy) as NullCityControlClient }, args);
    await runAttentionGrant({ store, control: fakeControl(spy) as NullCityControlClient }, args);
    expect(await store.getApBalance(cityUser.id)).toBe(625); // 750-125, debited once
    expect(spy.calls).toHaveLength(1);
  });
});
```
(If `getApBalance` isn't the real accessor, use the repo's existing AP-balance read — confirm in `postgres-store.ts:102`/`memory-store.ts`.) Run → FAIL. Then create `attention-grant.ts` with `runAttentionGrant({store,control}, input)` per the T0.0a spec: create intent → replay-short-circuit if already settled → debit stand-in (`sourceType:'attention_grant_standin'`, `metadata:{standin:true,nonProduction:true}`) → `state:'debited'` → `creditAttention` (wrap in try/catch → `state:'failed'` + rethrow) → `state:'settled'`. Run → PASS.

- [ ] **Step 5 — Wire the route.** `routes.ts:514-526` → call `runAttentionGrant({ store: context.store, control: context.nullcityControl }, {...})`; response carries `intent.state` + `city`, **no `mocked:true`**. Update `routes.test.ts:168-181` to inject a `nullcityControl` stub and assert the AP balance still reconstructs to `625` and the response is not `mocked`. Run `bun test src/city/ && bun run typecheck` → PASS.

- [ ] **Step 6 — Commit** (explicit file list per the T0.0a spec; no `-A`/`--amend`): `T0.0a: attention_grant_intents saga — real intent-tracked support (stand-in debit)`.

**Acceptance:** approved support writes an intent, debits the labelled stand-in, calls `creditAttention`, settles; idempotent under repeated key (one intent, one debit, one city call); response no longer `mocked`; stand-in clearly labelled + isolated to one swappable block; `bun test src/city/` + typecheck pass.

---

## Task 3: Shards-free settled-support letter seam — T0.0b

**Repo/runner:** Server, `npx jest`. New `recordSettledSupport` modeled on `PatronGateway.witnessAt` (`patron-gateway.ts:309-334` records standing + dispatches tier letters with **no** `currencyLedger.debit`). Reuses `produceStandingTierLetter` + `LettersStore.append` + `StandingLedger.recordSupport`.

**Files:** Create `src/controller/patron/settled-support.ts` + `settled-support.test.ts`; modify `city-integration/service.ts` (inject `standingLedger`/`lettersStore`; fire seam after credit ~:1018) and `controller-host.ts` (hoist `LettersStore` ~:199, inject at :213-224).

- [ ] **Step 1 — Failing unit test.** Create `src/controller/patron/settled-support.test.ts` (mirror `letters-store.test.ts` tmp-dir lifecycle):
```ts
import fs from 'fs'; import os from 'os'; import path from 'path';
import { LettersStore } from './letters-store';
import { StandingLedger } from './standing-ledger';
import { recordSettledSupport } from './settled-support';

describe('recordSettledSupport (Shards-free Leg D seam)', () => {
  let root: string; let lettersStore: LettersStore; let standingLedger: StandingLedger;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'settled-support-')); lettersStore = new LettersStore(root); standingLedger = new StandingLedger({ now: () => new Date('2026-06-03T00:00:00Z') }); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('appends one tier letter + one standing record, no currency debit', () => {
    const res = recordSettledSupport({ patronHandle: 'alice@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 10, ts: '2026-06-03T00:00:00.000Z' }, { standingLedger, lettersStore });
    expect(standingLedger.points('alice@onion', 'embassy')).toBe(10);
    expect(standingLedger.history('alice@onion', 'embassy')).toHaveLength(1);
    const inbox = lettersStore.readInbox('alice@onion');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe('standing_tier_crossed');
    expect(res.lettersAppended).toBe(1);
  });
  it('idempotent: same ts twice yields one letter', () => {
    const args = { patronHandle: 'alice@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 10, ts: '2026-06-03T00:00:00.000Z' };
    recordSettledSupport(args, { standingLedger, lettersStore }); recordSettledSupport({ ...args }, { standingLedger, lettersStore });
    expect(lettersStore.readInbox('alice@onion')).toHaveLength(1);
  });
  it('applies onionsPerStandingPoint scale (no 1:1)', () => {
    recordSettledSupport({ patronHandle: 'bob@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 100, ts: '2026-06-03T00:00:00.000Z' }, { standingLedger, lettersStore, onionsPerStandingPoint: 10 });
    expect(standingLedger.points('bob@onion', 'embassy')).toBe(10);
  });
  it('sub-point settle records nothing', () => {
    const res = recordSettledSupport({ patronHandle: 'carol@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 5, ts: '2026-06-03T00:00:00.000Z' }, { standingLedger, lettersStore, onionsPerStandingPoint: 10 });
    expect(res.standingPointsApplied).toBe(0);
    expect(lettersStore.readInbox('carol@onion')).toEqual([]);
  });
});
```
Run `npx jest src/controller/patron/settled-support.test.ts` → FAIL (module not found). (Confirm exact `StandingLedger` ctor + `points`/`history`/`readInbox` signatures against `standing-ledger.ts`/`letters-store.ts` before finalizing assertions.)

- [ ] **Step 2 — Implement `settled-support.ts`** per the T0.0b contract: `standingPoints = floor(onionsSettled / (onionsPerStandingPoint ?? 1))`; if `<1` skip (return `{standingPointsApplied:0, lettersAppended:0}`); `recordSupport(patronHandle, faction, standingPoints, {reason, ts})`; for each `tiersCrossed`, `produceStandingTierLetter(...)` → `lettersStore.append` when non-null; **never import/call any `CurrencyLedger`.** Run → PASS.

- [ ] **Step 3 — Inject + fire seam (integration).** `service.ts`: add `standingLedger?: StandingLedger; lettersStore?: LettersStore;` to `CityIntegrationOptions` (:142); capture on the class (:291-299); after the `economyEventLog.append` in `creditAttention` (~:1018), inside the idempotent callback, **best-effort guarded** (try/catch swallow, mirror :965-972): resolve `faction` from `getRuntime(residentName)?.getState().faction ?? 'embassy'`; if `standingLedger` and a resolved `patronHandle` exist, call `recordSettledSupport(...)`. (The `patronHandle` arrives via Task 4's wiring; until then the guard skips — seam is dark but unit-proven.) `controller-host.ts`: hoist `new LettersStore(...)` (:199) to `this.lettersStore`; add `standingLedger: this.standingLedger, lettersStore: this.lettersStore` to the `CityIntegrationService({...})` options (:213-224). Run `npx jest src/controller/controller-host.test.ts src/controller/city-integration` → PASS.

- [ ] **Step 4 — Commit** (new files + `service.ts` + `controller-host.ts`, explicit list): `T0.0b: Shards-free settled-support seam (standing + letter, no currency debit)`.

**Acceptance:** `recordSettledSupport` appends exactly one idempotent letter + one standing record, never calls a currency debit; scaled by `onionsPerStandingPoint` (not 1:1); sub-point settles record nothing; injection wired in host; existing `controller-host`/`city-integration` suites stay green. **Live verification of the wired path is restart-gated → queue for the steward.**

---

## Task 4: Integration capstone — the walking skeleton end-to-end

Wire the three pieces so a settled support produces a letter, using `personId→patronHandle`. **Unit/integration tested with mocks; live game verification queued for the steward (restart-gated).**

**Files:** Dashboard `attention-grant.ts` / `routes.ts` (resolve `personId` + pass to `creditAttention`), `memory-store.ts`/`postgres-store.ts`/`store.ts` (populate alias on `upsertUserFromLanding`), server `service.ts` (use `personId`→ resolve `patronHandle`? — see note).

- [ ] **Step 1 — Populate the alias on upsert (failing test).** In `identity.test.ts`, assert that after `upsertUserFromLanding(landingUser)`, `resolvePatronHandle(landingUser.id)` returns `landingUser.handle`. Run → FAIL. Then in `upsertUserFromLanding` (all 3 impls) call `setIdentityAlias(landingUser.id, landingUser.handle)` when `handle` is present. Run → PASS. (This gives the skeleton a real `personId→patronHandle` without a separate backfill.)

- [ ] **Step 2 — Resolve + forward `personId` in the saga (failing test).** In `attention-grant.test.ts`, assert the `creditAttention` body includes `personId` resolved from `cityUserId`. Run → FAIL. Then in `attention-grant.ts`, before the City call, `const personId = await store.resolveOnionId(input.cityUserId);` and include `personId` in the `creditAttention` body. Run → PASS.

- [ ] **Step 3 — Decide patronHandle delivery to the seam (DECISION — may queue).** The server seam needs `patronHandle`. Two options: (a) the BFF resolves `patronHandle` and passes it to City as a field on the grant (extends `attentionGrantRequestSchema`), or (b) the server resolves it from `personId` via a server-side copy of the alias. **(a) is simpler and in-our-control** (BFF already has the alias). Implement (a): add optional `patronHandle: z.string().optional()` to `attentionGrantRequestSchema`; BFF sends it; the Task 3 seam uses `request.patronHandle`. If this proves to need a server schema decision you're unsure about → **log under Decisions waiting and stop here**; Tasks 1–3 still stand alone.

- [ ] **Step 4 — Integration test (BFF, mocked City).** Prove: support → intent settled → the (mocked) City client received `{amount, personId, patronHandle, idempotencyKey}`. Run the dashboard `city/` suite + typecheck → PASS.

- [ ] **Step 5 — Commit** + **queue live verification.** Commit the wiring. Append to the Run Log: "Walking skeleton unit-proven end-to-end; LIVE verification (real controller + game, real letter in `/v1/inbox`) is restart-gated → queued for runtime-steward."

**Acceptance:** unit/integration tests prove a settled support carries `personId` + `patronHandle` to City and (via Task 3, when live) would dispatch one letter; alias auto-populates on upsert; no `resident-runtime.ts` edits; live verification clearly queued, not faked.

---

## Self-review (against the design doc §6/§8)

- **Spec coverage:** Task 1 = T0.ID (design §4.5/§8). Task 2 = T0.0a (§8, Phase 0.0 fork (ii) stand-in). Task 3 = T0.0b (§4.2 Leg D seam, D-DISPATCH-SEAM). Task 4 = the §6 Phase 0.0 walking skeleton, minus the Dev-gated real spend (stand-in) and minus live verification (restart-gated, queued). T0.A/T0.B/T0.1 (landing API, HMAC, reconciler) are **correctly excluded** — Dev-gated. T0.4 (death guardrail) excluded — touches `resident-runtime.ts`, co-design with the other agent's watchability work.
- **Placeholder scan:** code blocks are real and copied from verified source; the few "confirm exact signature" notes (StandingLedger ctor, `getApBalance`) are flagged as verify-at-execution, not invented.
- **Type consistency:** `personId` (string = landing users.id) used consistently; City field is `amount` (not `apAmount`) at the client boundary — flagged in Task 2/4; `AttentionGrantIntentState` reused across store + saga.

---

## Run Log (executor appends per task)

| Time | Task | Status | Tests | Notes |
|------|------|--------|-------|-------|
| (seed) | — | ready | — | Plan written; worktrees not yet created (create at execution start). |

**Decisions waiting (for James/Dev):**
- (none yet — Task 4 Step 3 may add one if patronHandle delivery needs a schema call.)

**Queued for runtime-steward (restart-gated live verification):**
- Task 3/4: live "support → attention → real letter in `/v1/inbox`" on a running controller + game.
