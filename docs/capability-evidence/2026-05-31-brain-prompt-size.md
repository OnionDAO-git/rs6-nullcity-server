# S-INFER-3 — Brain prompt size trim (113 KB perception → 11.4 KB assembled prompt)

Date: 2026-05-31
Lane: INFER
Branch: agents/wip
Status: prompt size cut PROVEN BY TEST. Live timeout-rate / usable-brain-rate
impact PENDING controller restart + `npm run controller:inference-audit`.

## Symptom (live evidence, controller pid 56058, 23 residents, 30-min window)

- `brainDecisions=475`, `usable-brain-rate=0.0%`, dominated by
  `request_timeout=80` + `empty=124`, `recovered=0` (parser salvage rescued
  nothing — the brain was not answering in time, not a parse bug).
- Trajectory `begin_tick` lines showed `perceptionBytes: 113477` — a 113 KB
  perception per brain call.
- Brain timeout 20000ms, thinking ON (both correct and UNCHANGED here).

## Root cause (measured, not guessed)

The brain prompt is assembled by `buildBrainPrompt()` in
`src/controller/thinking/hybrid-agent-prompts.ts`. Its `Perception` section came
from `summarizePerception()`, which did:

```ts
// OLD
const compressed = typeof perception.compressed === 'string' ? perception.compressed : undefined;
if (compressed) return compressed.slice(0, 12000);
return JSON.stringify(perception, null, 2).slice(0, 12000);
```

Two compounding problems:

1. **Blind char-slice.** It slices stringified perception JSON to 12000 chars.
   In a dense embassy scene the perception serializes `nearby.objects` (floor
   decorations) first — 598 of them — so the entire 12 KB budget is consumed by
   floor objects, **structurally crowding out** the survival spine: resident
   HP/inventory, nearby NPCs, ground items, and chat/combat events the brain
   actually needs to decide. The cut can also land mid-object (invalid JSON).

2. **Upstream blob is 113 KB.** `PerceptionCompressor.compress()`
   (`src/controller/perception/perception-compressor.ts`) has a hot-event bypass:
   when a hot event is present (chat/hit/attacked — constant in a 23-resident
   embassy) it sets `text = JSON.stringify({ current: next, delta })`, i.e. it
   dumps the **entire raw perception** (`current: next`) with no per-list cap; the
   `maxTokens` loop only drops the `baseline`, never the object list. That blob is
   the `perception.compressed` the brain prompt then sliced.

## Byte breakdown of the OLD 18.3 KB assembled brain prompt (heavy 598-object scene)

Measured deterministically by assembling `buildBrainPrompt()` over a realistic
heavy perception (598 floor objects + 40 NPCs + 60 ground items + hot chat event,
raw perception ~110 KB — matches the live 113477):

| Section                                   | Bytes  | Share |
|-------------------------------------------|--------|-------|
| **Perception section (blind char-slice)** | 12012  | 65%   |
| Header + scaffold + soul-identity         | 6332   | 35%   |
| — of which soul.body                      | 2160   |       |
| Playbook                                  | 743    |       |
| **TOTAL**                                 | 18344  | 100%  |

The 12 KB perception was the dominant bloat **and** was almost entirely floor
objects (the same 18344 total whether the scene had 598 or 200 objects — the
slice always fills 12 KB with objects before reaching NPCs/items/events).

## Fix

NEW `src/controller/llm/prompt-budget.ts`: a bounded, structured perception
summariser. It keeps the resident's own state (position/HP/combat/inventory/
trade/quests) and recent events intact, and caps each nearby-entity list to the
N **closest** to the resident by Manhattan distance — prioritising the entities a
decision needs over floor decorations. It also surfaces `elidedCount` so the
brain knows the scene is denser than shown. Caps are named constants with sane
defaults, overridable per call. Compact JSON render + a last-resort hard char
ceiling as a safety net for pathological single-event payloads.

`summarizePerception()` in `hybrid-agent-prompts.ts` now calls
`renderBudgetedPerception()` whenever the structured `nearby`/`resident` fields
are present (the live shape), and only falls back to the old compressed string
when they are absent — and even then caps it at the same ceiling instead of
12000.

### Caps added (defaults)

- `maxNearbyObjects = 20`  (was: unbounded → ~hundreds in the 12 KB slice)
- `maxNearbyNpcs = 16`
- `maxNearbyPlayers = 12`
- `maxNearbyItems = 16`
- `maxEvents = 12`  (last-N most recent)
- `maxInventory = 28`  (one full RS inventory)
- `summaryBudgetChars = 6500`  (hard ceiling safety net)

## AFTER (proven by test)

| Metric                                  | Before  | After   |
|-----------------------------------------|---------|---------|
| Assembled brain prompt (598-obj scene)  | 18344 B | 11411 B |
| Perception section                      | 12012 B | 5042 B  |
| Floor objects serialized                | hundreds| ≤ 20    |

The 5 KB perception is now real survival content (resident state, nearest NPCs,
ground items, recent events, nearest 20 objects) — not 12 KB of blind-sliced
floor decorations. Survival spine + soul goal preserved (asserted by test).

## Tests

- `src/controller/llm/prompt-budget.test.ts` (NEW, 6 tests): caps applied;
  survival spine kept; **nearest** entities retained (not first-in-list);
  `elidedCount` reported; heavy scene under char budget; never throws on
  malformed input.
- `src/controller/thinking/hybrid-agent-prompts.test.ts` (+3 tests): assembled
  brain prompt `< 16_000` bytes for the heavy scene; survival spine + goal +
  events preserved; floor objects capped (`≤ 25` `objectId` occurrences) with
  `elidedCount` surfaced.

## Honesty / what is NOT proven here

Prompt size cut is a pure function of the assembled string and is proven
deterministically by the tests above. The **live** timeout-rate drop and
usable-brain-rate rise CANNOT be proven from the sandbox — they need a controller
restart onto this build.

## Live-verify recipe (post-restart)

1. Restart the controller onto this `agents/wip` build.
2. Run a hero window, then `npm run controller:inference-audit`.
3. Confirm `request_timeout` drops sharply and `usable-brain-rate` rises from
   0.0%. (If `empty`/`think_only_no_answer` persist after timeouts fall, that is
   the separate model/parse axis owned by S-INFER-1/2/MODEL.)
4. Optionally re-check trajectory `begin_tick` `perceptionBytes` is unchanged
   (that measures the RAW upstream perception, not the prompt) — the win is in
   the assembled prompt, which is not logged per-tick; verify via the budget test.
