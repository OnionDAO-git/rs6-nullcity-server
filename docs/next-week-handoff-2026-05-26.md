# Next-Week Handoff — 2026-05-26+

**Audience:** whoever picks up after the weekend cron terminates — claude, codex, antigravity, or the maintainer.

**Purpose:** every Pillar-3 capability shipped this weekend is dormant substrate UNLESS wired into the live tick. Three small wiring slices remain. This doc gives you the exact file, the exact insert point, and a working call-shape template for each — modeled on Antigravity's `628d27b6` death-loop wiring which is the proven pattern.

Each section below is **~30 lines of code** plus tests. Read the linked source files; the substrate is already designed for this exact integration point.

---

## Slice 1 — EVENT-D3-wire (embassy reception greeting)

**Goal:** when a registered patron chats inside the embassy region, the nearest hero resident emits a greeting + the patron loop records a `witnessAt`. Substrate is `src/controller/embassy/reception-reflex.ts` (committed `b38b937e`).

**File to touch:** `src/controller/resident-runtime.ts`.

**Where to insert the hook:** the new method goes alongside `checkDeceasedAndDispatchEpitaphs` (line 613). Call it from `handlePerception` right after `withPendingEvents` populates the perception bag — same place patron-witness observation already happens (around line 202–204 or line 335 where `checkDeceasedAndDispatchEpitaphs` is called today).

**Code skeleton** (drop into `resident-runtime.ts`):

```ts
import { evaluateReceptionGreeting } from './embassy/reception-reflex';
// (PatronGateway is already constructed in ControllerHost — needs to be
//  injectable here. If options.patronGateway is not currently on
//  ResidentRuntimeOptions, add it as `patronGateway?: PatronGateway` so
//  the host can pass through. See controller-host.ts:102-109.)

private maybeGreetPatron(perception: Perception): void {
    if (!this.options.patronGateway) {
        return;
    }
    const greeting = evaluateReceptionGreeting({
        perception: perception as Record<string, unknown> | null | undefined,
        residentName: this.name,
        registry: this.patronRegistry,
        // displayNames: optional, threaded from PatronConfig if present.
    });
    if (!greeting) {
        return;
    }
    // Side-effect 1: queue the say action through the normal action path.
    // (Pattern: stash on `pendingDirectAction` and let the next tick emit it,
    //  OR call the body adapter directly. The simplest path uses the same
    //  this.body.submitAction(greeting.action) shape used elsewhere.)
    void this.body.submitAction(greeting.action);

    // Side-effect 2: record the patron-witness event so the library timeline
    // gets the patronHandle (which the death loop later reads).
    void this.options.patronGateway.witnessAt(
        greeting.witness.patronHandle,
        greeting.witness.landmarkId,
        greeting.witness.residentName,
    );
}
```

**Call site:** add `this.maybeGreetPatron(perception);` immediately above the existing `this.checkDeceasedAndDispatchEpitaphs(perception);` call (resident-runtime.ts:335).

**Test scaffolding** (`resident-runtime.test.ts`, follow the existing D4 patron-witness test pattern):

```ts
it('emits a reception greeting when a registered patron chats inside the embassy', async () => {
    const runtime = makeRuntime({
        patrons: [{ handle: 'alice@onion', kind: 'patron_witness' }],
        patronGateway: { witnessAt: jest.fn().mockResolvedValue({ ok: true }) },
    });
    const perception = perceptionInsideEmbassyWithChat('alice@onion', 'hi');
    await runtime.onPerception(perception);
    expect(submitActionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'say', text: expect.stringMatching(/alice@onion/) })
    );
    expect(runtime.options.patronGateway.witnessAt).toHaveBeenCalledWith(
        'alice@onion', 'embassy', expect.any(String)
    );
});
```

**Idempotency:** the reflex's "most-recent-chat wins" semantics + a cooldown (~10 ticks via `state.hookCooldowns`, key `'embassy_greeting'`) prevent re-greeting the same patron every tick.

---

## Slice 2 — L-α-3 (fire-lit reflex + moment-labeler)

**Goal:** when a resident successfully lights a fire, the cross-resident `LoreBus` broadcasts `fire_lit` AND the resident's trajectory gets a labeled `moment` entry. Substrates: `src/controller/lore/lore-bus.ts` + `src/controller/lore/fire-lit-reflex.ts` (committed `8dc77e1f`) + `src/controller/evidence/moment-labeler.ts` (committed `008fcd5d`).

**Files to touch:**
- `src/controller/controller-host.ts` — instantiate the singleton `LoreBus` once per controller, pass to every runtime.
- `src/controller/resident-runtime.ts` — construct `FireLitReflex(bus)` + `MomentLabeler` per resident; call `.observe(perception, name)` each tick; on successful publish, call `momentLabeler.noteFireLit({position})`.

**ControllerHost skeleton** (add after existing patron/letters construction):

```ts
import { LoreBus } from './lore/lore-bus';
// ...
private readonly loreBus = new LoreBus();
// ... and pass into runtime construction:
const runtime = new ResidentRuntime({
    // ...existing options
    loreBus: this.loreBus,
});
```

**ResidentRuntime skeleton:**

```ts
import { FireLitReflex, FIRE_LIT_LORE_KIND } from './lore/fire-lit-reflex';
import { MomentLabeler } from './evidence/moment-labeler';

// In constructor:
this.fireLitReflex = new FireLitReflex({ bus: options.loreBus });
this.momentLabeler = options.evidence
    ? new MomentLabeler({ builder: makeMomentBuilder(options.evidence.trajectory) })
    : undefined;

// In handlePerception (after withPendingEvents):
const fireEvent = this.fireLitReflex.observe(
    perception as Record<string, unknown> | null | undefined,
    this.name,
);
if (fireEvent && this.momentLabeler) {
    const payload = fireEvent.payload as { position: { x: number; y: number; level: number } };
    this.momentLabeler.noteFireLit({ position: payload.position });
}
```

**`makeMomentBuilder` adapter** (small new file or inline helper — the MomentLabeler's `MomentTrajectoryBuilder` interface accepts any object with `append(kind, fields)`, which is exactly what `TrajectoryBuilder` already does privately; expose a public method or wrap):

```ts
function makeMomentBuilder(tb: TrajectoryBuilder): MomentTrajectoryBuilder {
    return { append: (kind, fields) => (tb as any)._append(kind, fields) };
    // OR: add a public `appendForExternal` method to TrajectoryBuilder.
}
```

**Tests:** reuse `fire-lit-reflex.test.ts` patterns. Drive `runtime.onPerception(noFire)` then `runtime.onPerception(withFire)` and assert (a) bus has a `fire_lit` event, (b) trajectory has a `moment.kind === 'fire_lit'` line.

---

## Slice 3 — L-β-2 (whisper inbox into perception)

**Goal:** a resident sees whispers addressed to them as perception events on the next tick. Substrate: `src/controller/lore/whisper.ts` (committed `8ea23b6d`) with `publishWhisper` + `whisperInboxFor`.

**Files to touch:** `src/controller/resident-runtime.ts` only.

**Code skeleton:**

```ts
import { whisperInboxFor } from './lore/whisper';

// In constructor (after loreBus is wired from L-α-3):
this.whisperInbox = whisperInboxFor(options.loreBus, this.name, {
    // Optional proximity gate — uses resident's current position.
    // For simplicity v1: omit and rely on publisher-side radius.
});

// In handlePerception, BEFORE withPendingEvents merges into perception:
const drainedWhispers = this.whisperInbox.drain();
for (const whisper of drainedWhispers) {
    this.pendingEvents.push({
        kind: 'whisper',
        text: whisper.text,
        from: { name: whisper.from },
        ts: whisper.ts,
    });
}
```

**Bonus:** the `kind: 'whisper'` event then flows through the existing patron-observation path at resident-runtime.ts:409 if the from-name happens to be a registered patron. Free Pillar-3 win.

**Tests:** publish a whisper via `publishWhisper(bus, {from, to: name, text, position})` then assert `runtime.onPerception(...)` next tick sees a `whisper` event in perception.events.

**Cleanup on stop:** call `this.whisperInbox.unsubscribe()` from `ResidentRuntime.stop()`.

---

## Bonus — small wins (no runtime touch)

These are pure data/doc additions a non-engineer (or claude/codex/antigravity) can ship in <10 min:

- **Add a 4th hero soul** (e.g. `res:duke-horacio` in Lumbridge castle) at `src/controller/soul/starter-souls/res-duke-horacio.md`. Mirror the Hans/Father Aereck shape.
- **Add a sample patron** to `controller.yml`'s `patrons:` block so a fresh-clone smoke test exercises the patron-registry path. E.g. `- handle: demo@onion`, `kind: patron_witness`.
- **Squash-merge `agents/wip` → `nullcity`** per Rule 3 cadence floor. `agents/wip` is now ~155 commits ahead. Subject suggestion: `"Squash: Pillar-3 IRL infrastructure (EVENT-D1..D6 + OPS + handoff)"`. Body: the file table from `docs/weekend-brief-2026-05-25.md`.

---

## How to use this doc

**Suggested first hour Monday:**
1. Read this doc end-to-end (5 min).
2. Read `docs/weekend-brief-2026-05-25.md` for full context (5 min).
3. Pick Slice 1 (EVENT-D3-wire) first — smallest, no new dependencies, immediate visible win. Should land in 30 min including tests.
4. Verify locally with `npm test -- --runInBand --testPathPattern "resident-runtime|reception-reflex"` then a live smoke (the runbook has the recipe).
5. Move to Slice 2 (L-α-3) — requires the `makeMomentBuilder` decision (public method vs. cast). The cast is faster but ugly; the public method is the right call. Ship the public method as its own micro-slice if needed.
6. Slice 3 (L-β-2) is the smallest of the three — ~10 lines plus the cleanup hook.

**If concurrent agents are in `resident-runtime.ts`:** stage the wiring slices behind theirs. Slices 1/2/3 are additive (new methods + new call sites at the bottom of `handlePerception`); merge conflicts are unlikely but possible. The audit-friendly path is single-author land of all three in one short window, then re-run the full Jest suite to confirm nothing regressed.

---

## What's deliberately NOT in this doc

- **N-β reception clerk NPC** — engine-plugin work (server/plugins/), not controller-side. Different territory, different skill set.
- **K factions combat policy** — substrate exists in soul-schema but the integration target (some combat decision function) hasn't been spec'd yet.
- **Mortician's Ribbon** + tombstones — post-event polish; not on the critical path.
- **Static wall ticker** — already shipped this weekend (`public/wall/index.html`, commit `be9fd223`).

---

*Generated 2026-05-23 17:30 CDT by claude. The Pillar-3 substrate this doc plugs into is 100% on `agents/wip`. The wiring patterns are based on Antigravity's proven `628d27b6` (EVENT-D4 / J1) wiring. — c*
