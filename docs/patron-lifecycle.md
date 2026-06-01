# Patron Lifecycle — first encounter to legacy

> ⚠️ **Currency + path note (2026-05-31, packet `E2E-DOC-COHERENCE-1`):** this doc predates the pivot. Read **"Shards" as "AP" (Attention Points)** throughout — same ledger, renamed. The canonical economy path is now the **City API on `43611`** (`/api/nullcity`, `Bearer <city-http-token>`), which is what the dashboard uses; see `HUMANS.md` § Patron flow. The `patron:offer` MCP flow below still produces standing + tier letters, but is **rejected by the live stack unless the controller was started with `CONTROLLER_MCP_TOKENS`** — and the City API `attention-grants` path does **not** yet emit standing/letters. The two halves are not unified yet; verify against `HUMANS.md` before relying on the exact stdout shown here.

> **Audience:** OnionDAO Chicago staff, volunteers, and Tuesday-morning maintainers picking this up cold. If you've never run the patron CLI before, start here, then keep `docs/embassy-staff-runbook.md` open on a second tab for the door-side cheat sheet.

This is the **narrative companion** to the runbook. Where the runbook is a laminated reference card for the door, this is the story arc: what happens to a patron from the moment they walk up to the embassy table, through their first tier crossings, into the deep weeks where Standing persists across restarts, and finally — if a resident they sponsored dies — through the death-loop epitaph that lands in their inbox naming them by handle.

Tasks #162 (patron onboarding flow) and #175 (patron lifecycle) both resolve to this doc.

---

## 5-minute quickstart (Chicago volunteer, never seen this)

You are at the door. A patron named **alice@onion** has just shown you her badge. Open a terminal.

```bash
# 1. Give her starter currency
npm run patron:grant -- --human alice@onion --amount 10

# 2. She picks res:hans. Spend it all — this crosses Acquaintance AND dispatches her welcome letter in one shot.
npm run patron:offer  -- --human alice@onion --resident res:hans --amount 10

# 3. Read the [patron:offer] Inbox: line of stdout. Hand her that URL (or scan the QR).
#    She refreshes the page within ~5 seconds and sees a vellum-styled scroll
#    "You are now Acquaintance of embassy."

# 4. Hans says her name out loud within ~3 seconds via the nervous:patron-memory-acknowledge
#    reflex (HD-031). If she's near a screen showing his trajectory, she'll see:
#       Hans: "Thank you for the Shards, alice@onion, and everyone backing me!"
```

That's the full first-encounter loop. The rest of this doc is what happens next.

---

## Lifecycle overview

| Phase | Wall clock | What changes |
|---|---|---|
| **1. First encounter** | T+0 | Patron exists in the ledger. Has Shards. Crossed Acquaintance. First letter dispatched. Hero acknowledges by name. |
| **2. Growing relationship** | T+5 min – T+1 h | Repeat offers / asks / witnesses. Crosses Ally (≥30), then Officer (≥75). One letter per tier crossed, in ascending order. |
| **3. Persistent relationship** | T+ days, months | Standing is PERMANENT (HD-046 / E43). Officer forever. Inbox survives every restart. |
| **4. Death-loop legacy** | T+ hours to days | A resident the patron supported dies. Epitaph letter dispatches to their inbox, naming them by handle, naming the resident, recording lived ticks and lasting impressions. |

---

## Phase 1 — First encounter at the embassy (T+0)

Staffer and patron stand at the table. The controller is already running (see `docs/embassy-staff-runbook.md` § Pre-event setup).

### Step 1: grant starter Shards

```bash
npm run patron:grant -- --human alice@onion --amount 10
```

Expected stdout:

```
[patron:grant] Successfully credited 10 Shards to human "alice@onion".
[patron:grant] New balance: 10 Shards.
```

`alice@onion` now exists in the currency ledger. Nothing else has fired yet — no letters, no standing, no reflex. The Shards are just sitting in her wallet.

### Step 2: she picks a resident and supports them

Ask her: "Who would you like to support?" Pull the list from `ls src/controller/soul/starter-souls/` — Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, Thrand are the named heroes; `res:qa-*` souls are also alive.

Once she picks (let's say `res:hans`):

```bash
npm run patron:offer -- --human alice@onion --resident res:hans --amount 10
```

Expected stdout (annotated):

```
[patron:offer] Offered 10 Shards from "alice@onion" to "res:hans".
[patron:offer] Event ID: <uuid>
[patron:offer] Standing with faction "embassy": 0 -> 10            ← crossed Acquaintance threshold (10)
[patron:offer] Tiers crossed: acquaintance (1 letter dispatched)   ← one letter on disk for her
[patron:offer] Inbox: http://127.0.0.1:43596/v1/inbox?human=alice%40onion
```

What just happened, in order:
1. **10 Shards debited** from `alice@onion` → wallet now 0.
2. **100 attention added** to `res:hans` (10 attention per Shard).
3. **Standing recorded:** `alice@onion` in faction `embassy` went 0 → 10. That crosses the Acquaintance threshold (`STANDING_TIERS` in `src/controller/patron/standing-ledger.ts` → `[acquaintance: 10, ally: 30, officer: 75]`).
4. **Letter produced:** `produceStandingTierLetter` emits one Letter (`kind: 'standing_tier_crossed'`, `subject: "You are now Acquaintance of embassy"`) and `LettersStore` appends it to `data/controller/memory/data/letters/aliceonion/inbox.jsonl`.
5. **Hero acknowledge reflex fires.** `res:hans`'s nervous system scans recent patron Library memories, picks the latest unacknowledged patron, and queues a `say` like `"Thank you for the Shards, alice@onion, and everyone backing me!"` — visible within ~1–3 seconds (HD-031 / verified E47).

Hand her the URL printed on the `[patron:offer] Inbox:` line, or have her scan a QR that resolves to it. She refreshes and sees the welcome scroll.

Optional: print the letter to a lanyard card (Cmd-P from the inbox page; see runbook § "Print the letter to a lanyard card").

---

## Phase 2 — Growing relationship (T+5 min)

Alice wanders into the room. Bob shows up next. She comes back later wanting to do more. Three patron verbs are available beyond `offer`:

| Verb | What it does | Cost | Standing impact |
|---|---|---|---|
| `patron:offer` | Default support — Shards → attention + standing | Shards | configurable (≥1 per Shard) |
| `patron:witness` | Records a witnessed act (landmark, brave fight) | Free | +3 standing |
| `patron:ask` | Patron asks a free-text question; resident sees it as a `chat` perception + acknowledge reflex fires | Free | small standing bump |

### Example: walking the room

```bash
# She watched Hans light a fire at the church
npm run patron:witness -- --human alice@onion --resident res:hans --note "watched him light a fire by the church"

# She asks him a question
npm run patron:ask -- --human alice@onion --resident res:hans --text "Hans, what is the best way to Varrock?"

# She tops up and offers again
npm run patron:grant -- --human alice@onion --amount 20
npm run patron:offer -- --human alice@onion --resident res:hans --amount 20
```

After this stretch her standing is somewhere around 33. She crossed **30** at some point — that triggered an Ally letter ("You are now Ally of embassy") to land in her inbox. She refreshes the page and sees the second scroll above the first.

### Multi-tier crossings in one shot (HD-040 / E38)

A single big grant can cross multiple thresholds at once. The dispatcher (`patron-gateway.ts`) iterates `tiersCrossed: StandingTier[]` from the standing ledger and emits **one letter per tier in ascending order** — not just the highest. Example:

```bash
# Bob has zero standing. One large offer takes him stranger → officer.
npm run patron:grant -- --human bob@onion --amount 80
npm run patron:offer -- --human bob@onion --resident res:hans --amount 80
```

Expected stdout includes:

```
[patron:offer] Standing with faction "embassy": 0 -> 80
[patron:offer] Tiers crossed: acquaintance, ally, officer (3 letters dispatched)
```

Bob's inbox now holds **three letters**, dispatched in ascending order: Acquaintance, then Ally, then Officer. Each is a distinct scroll with a distinct body. This was a bug pre-E38 (only the highest tier shipped); the per-tier emission is now verified by +8 regression tests across 3 suites.

---

## Phase 3 — Persistent relationship (T+ days)

**Standing is monotonically permanent.** Once Officer, forever Officer.

This was audited in E43 / HD-046 across `standing-ledger.ts`, `check-in-tracker.ts`, `patron-store.ts`, and the spec: no `reduceSupport` op exists, runtime + Zod schemas enforce positive-only support, and live evidence (8 humans, all-positive history, zero negatives) confirms it. The spec line that originally flagged decay rate as "maintainer decision" was closed by default — no decay.

Operational implications:

- A patron who came to a single OnionDAO event in May is still Officer in October.
- Their `inbox.jsonl` survives every controller restart — files live under `data/controller/memory/data/letters/<slug>/`.
- If their sponsored resident dies six weeks after they last visited, the **epitaph still dispatches to their inbox** (see Phase 4).
- LettersStore slugs are case-insensitive: `Alice@Onion`, `alice@onion`, and `ALICE@ONION` all share one inbox.

If a maintainer ever wants standing decay for game-economy reasons, that's a separate substrate change (new `reduceSupport` op + `standing_demoted` letter kind). Not Chicago-relevant.

---

## Phase 4 — Death-loop legacy (T+ hours to days)

Residents die from two causes:
1. **In-game combat / damage** — goblin chickens, drowning, ambient hazards.
2. **Attention exhaustion** — they ran out of will to act because nobody was supporting them.

**Hero protection (HD-008 / E30):** the six named heroes (Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, Thrand) carry an `attentionProfile.floor` (Hans/Aereck/Wise/Duke = 5000; Pip/Thrand = 3000) that prevents them from dying of attention exhaustion specifically. They can still die from combat / damage. QA souls and `res:agent` have no floor and can attention-die.

### What fires when a resident dies

The death loop runs automatically inside `ResidentRuntime.onPerception` when `state.deceased` is set:

1. `buildEpitaphDispatchRequests` collects every patron who ever supported the deceased resident — pulled from the standing ledger + library timeline.
2. `dispatchEpitaphs` produces one Letter per patron with `kind: 'epitaph'`, body naming:
   - the deceased resident (e.g. `res:fern`)
   - their lived ticks
   - their lasting impressions (skills, milestones, named contributors)
3. Each Letter delivers to all three channels: `web-inbox`, `in-game-scroll`, and `lanyard-card`.
4. The state is marked processed so a restart won't re-fire.

### What the patron experiences

Alice supported `res:fern` three weeks ago and forgot about it. Today, mid-event, Fern dies in combat. Alice's inbox gets a new entry within seconds:

> *To alice@onion —*
> *Fern of Lumbridge has passed. She lived 47,200 ticks, learned firemaking, was witnessed by you and three others lighting her first fire by the church. Your support carried her further than she knew. The clerks of embassy will remember her name. — embassy*

(The actual body template lives in `letters-producer.ts`'s epitaph builder; I haven't reproduced it line-for-line here. See *Open gaps* at the bottom.)

### What staffers do

Per the runbook § "When a resident dies":

```bash
# Find the patrons who supported the deceased
ls data/controller/memory/data/letters/
# grep each inbox.jsonl for kind=epitaph + this resident's name
```

Then notify each patron in person as they pass by — "Hey, fern died, there's a letter for you" — and print the epitaph to a lanyard card if they want a physical keepsake.

---

## What's wired vs not (Chicago-day expectations)

| Path | Status today | Notes |
|---|---|---|
| `patron:grant` → wallet credit | ✅ wired | |
| `patron:offer` → attention + standing + letter dispatch | ✅ wired | HD-040 / E38 per-tier emission verified |
| `patron:ask` → resident chat perception + acknowledge reflex | ✅ wired | HD-031, ~1–3 s response |
| `patron:witness` → +3 standing, no Shards | ✅ wired | |
| Standing-tier letters reach `inbox.jsonl` | ✅ wired | E6 dispatcher fix |
| `/v1/inbox` HTTP endpoint | ✅ wired | requires controller started with `--letters-http-port=43596` (HD-026) |
| Wall ticker `/v1/wall/snapshot` (redacted) | ✅ wired | requires `--wall-redact` flag (HD-029) |
| Hero acknowledge reflex (`nervous:patron-memory-acknowledge`) | ✅ wired | HD-031, verified E47 |
| Epitaph dispatch on resident death | ✅ wired | EVENT-D4 / J-δ-2 |
| Hero attention floor (heroes can't attention-die) | ✅ wired | HD-008 / E30 |
| **Implicit "patron walks in + speaks in-world → hero auto-greets"** | ❌ **NOT WIRED** | EVENT-D3 substrate ships in `embassy/reception-reflex.ts`; zero production callers per E50. Use CLI verbs for guaranteed acknowledgement (HD-018). |
| **Cross-resident chat / `fire_lit` narrative events** | ❌ **NOT WIRED** | L-α `LoreBus` + L-β whisper substrates exist with unit tests but never instantiated in `controller-host.ts`. Even `fire_lit` events have zero runtime effect today (HD-043 / E41). |

**Chicago-day rule of thumb:** if you want it to definitely happen, run a CLI verb. The implicit/ambient paths are post-Chicago workstream (`docs/next-week-handoff-2026-05-26.md` § Slice 1 + Slice 3).

---

## Failure mode triage

| Error / symptom | Likely cause | Fix |
|---|---|---|
| `insufficient_currency` | Patron has 0 Shards in wallet | `npm run patron:grant -- --human <handle> --amount 10` first |
| `cooldown_active` | Same patron sponsored same resident twice within 24 h | Wait, or pick a different resident |
| `resident_not_found` | Misspelled resident handle | `ls src/controller/soul/starter-souls/` for valid names (note: include the `res:` prefix on the CLI) |
| Empty inbox in browser | Controller's letters HTTP port (43596) not bound | Check controller stderr for `letters HTTP listening at …`; restart with `--letters-http-port=43596 --wall-redact` (HD-026 / HD-029) |
| `[patron:offer]` succeeds but no inbox URL printed | Old build, pre-E46 | Pull, rebuild, restart |
| Hero doesn't say the patron's name | Either (a) brain backlog → wait 5 s, or (b) hero is in combat/low-health (survival outranks acknowledge per HD-031) | Try `patron:ask` directly for a stronger nudge |
| Patron walks in, speaks in-game, nothing happens | D3 implicit greeting is unwired (HD-018) — this is **expected**, not a bug | Use CLI verbs |
| Two patrons share an inbox | Slugs are case-insensitive by design | Standardize on lowercase |

See also: `docs/embassy-staff-runbook.md` § Common error recovery for the door-side version.

---

## What the patron carries away

Tangible / persistent artifacts of their visit:

- **Inbox URL.** `http://<laptop-LAN-IP>/inbox/?human=alice@onion&api=http://<laptop-LAN-IP>:43596/v1/inbox`. Save it, scan a QR for it, or print the URL on a card.
- **Printed lanyard cards** of any letter they want to keep — welcome scroll, Ally / Officer crossings, future epitaphs. Cmd-P from the inbox page, cardstock, hole punch.
- **Permanent standing record** in the embassy ledger. Auditable from `data/controller/memory/data/letters/<slug>/inbox.jsonl` and the standing files. Survives every controller restart. Officer forever.
- **Future epitaph letters.** Any resident they ever supported, whenever that resident eventually dies, generates an epitaph that names them by handle and lands in this same inbox. The relationship outlives the resident.

---

## Cross-references

- `docs/embassy-staff-runbook.md` — laminate-this door reference; pre-event setup, print flow, live cheatsheet
- `docs/pre-chicago-readiness.md` — single-page readiness checklist
- `docs/intelligence-verification-log.md` § E30 (hero floor) / E36 + E38 (multi-tier letter fix) / E43 (no-decay audit) / E47 (full claude-as-human walkthrough) / E50 (D3 unwired confirmation)
- `docs/human-decisions.md` § HD-008 (hero attention floor) / HD-018 (D3 deferred) / HD-026 (letters HTTP port) / HD-029 (wall redaction + restart) / HD-030 (revive CLI) / HD-031 (patron-memory-acknowledge reflex) / HD-040 (per-tier letter emission) / HD-041 (cross-resident chat — closed not-a-bug) / HD-043 (L-α/L-β substrate unwired) / HD-046 (no-decay default)
- `docs/next-week-handoff-2026-05-26.md` § Slice 1 (D3 wire) + Slice 3 (LoreBus / whisper wire)

---

*Generated 2026-05-24 from the Pillar-3 patron-loop substrate. Reads correctly on Tuesday morning if `npm run patron:offer` still prints `[patron:offer] Tiers crossed:` (E38 contract). Update this file if that contract changes.*
