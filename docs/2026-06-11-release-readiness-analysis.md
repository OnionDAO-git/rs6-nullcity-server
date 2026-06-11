# Null City — Release Readiness Analysis (T-1, 2026-06-11)

**Owner:** Claude (release readiness) · **Method:** 4 expert subagent audits (product/human-desire, money path, infra/SRE, emotional core) against `agents/wip @e778e04f` + dashboard `wip/spec` + landing + on-disk data. Builds on the 2026-06-10 holistic design review (`4551ab0c`).

---

## Verdict in one paragraph

The machine works — all 5 loops verified, scarcity is real, the story (care → being-known → loss → legacy) is genuinely novel. But **on the path real humans use, three seams break the emotional promise**: (1) dashboard support never reaches the resident's mind (the ledger knows you; the resident doesn't), (2) death is switched off (floors + respawn = accidental immortality; 140 "I'm fading" letters from residents who cannot die), and (3) the payoff surfaces are hidden (Inbox is expert-gated; the Soul Library page reads a DB table nothing writes). All three are small fixes — the deepest is ~20 LOC. Separately, the **stack is 100% dark right now** (host rebooted yesterday; nothing autostarts; inference endpoints unreachable; server dist 6 days stale) and the **money path has two sharp edges** (silent one-click burn; burn-first with no refund). One evening of decisions + small fixes + ops, then a morning cold-path rehearsal, gets this to a defensible beta.

## The three seams (each <1 day, already scoped)

### SEAM-1 — Recognition: dashboard support never enters the resident's mind ⟶ ~20 LOC
`creditAttention` (`service.ts:1056-1071`) appends only `city_attention_credit` (cityUserId, no patronHandle). The patron-awareness machinery filters on `patron_gift|witness|sponsor|ask` (`library-memories.ts:76-78`) — so the prompt's patron slice, the thank-you reflex, name-recall, and **personal** epitaphs all skip dashboard supporters. FIX: when handle present, also append a `patron_gift`-kind event (or admit `city_attention_credit` to `isPatronKind` + render handle). Everything downstream is already built and tested. **This one fix makes "they'll know you" true.**

### SEAM-2 — Mortality: death is unreachable in current config ⟶ frontmatter only
All heroes have `attentionProfile.floor: 3000-5000`; all QA souls + res:agent have `respawnPolicy: on_restart`. 0 deceased on disk; every hero parked at exactly its floor. FIX (curated cohort): remove floor + respawnPolicy for 2-3 named non-hero souls, `decayCurve: gentle` + high `startingAttention` for multi-day runway. **No code change; no death-rate cap exists in code, so cohort size IS the cap.** Companion 1-liner: make the plea trigger strict (`attention > floor`, `nervous-system.ts:499/543`) so immortal floor-parked heroes stop sending fake "I'm fading" letters.

### SEAM-3 — Payoff visibility: supporters can't see letters or legacy ⟶ 2 small UI changes
(a) Inbox nav is `expertOnly` (`end-user-dashboard.ts:144`) — epitaphs/tier letters unreadable by their addressees; remove one word. (b) Soul Library page reads `library_soul_lives` — **a table with zero writers**; repoint to the working `/v1/graveyard` + `/v1/library` (`event-public.ts:74-83`); fetch-source change in `App.svelte`.

## Money path (dashboard `wip/spec` = the launch branch; main is a strict ancestor, 45 behind)

- **The UI support path does REAL onion burns whenever `ONION_EXTERNAL_API_KEY` is set — `ONION_SPEND_MODE` is a red herring** (it gates only the dead legacy endpoint). The kill switch is unsetting the API key.
- **Consent: today it is a silent one-click spend.** BFF auto-approves the landing burn with the user's own session cookie (`routes.ts:831-833`). User never sees an approval screen. Options: (1) in-dashboard confirm dialog — frontend-only, ~hours; (2) true landing consent — remove auto-approve, >1 day with polish. **Decision required.**
- **Burn-first, no refunds.** If City credit fails after the burn, the intent → `failed`: onions destroyed, no refund API exists, no user-visible pending/failed list. Retry mints a NEW idempotencyKey (`crypto.randomUUID()` per click) → **double-burn risk**. Ops remedy: watch `attention_grant_intents` in `failed|settling|awaiting_approval`; re-drive with the SAME key.
- **Missing for prod:** `ONION_CALLBACK_SECRET` (callback 503s without it), https callback URL, `AUTH_COOKIE_DOMAIN`, `CITY_DEV_AUTH_ENABLED=false`. Simple-UI copy audit: PASS (jargon is expert-gated).

## Infra (the city is dark RIGHT NOW)

- Host rebooted 2026-06-10 ~14:00; **nothing autostarts**; all screens gone; `/tmp` logs wiped (BFF-crash forensics lost); Docker daemon (OrbStack) down → Postgres down. Port 3000 is an unrelated EFS project, NOT landing (landing is SvelteKit :5173).
- **Inference endpoints unreachable** (`inf.nullcity.ai:1234`, `spacetower:8100` both time out). Nothing matters until this is fixed — residents are brainless without it.
- **Server `dist/` built Jun 5; HEAD is Jun 11** — bring-up without `npm run build` runs 6-day-old code.
- **BFF is the human-facing SPOF with zero supervision** (bare `bun --watch` in a screen; it crashed unattended this week). It's also the websocket game proxy. Wrap it in the supervised-restart pattern; drop `--watch`.
- **Probable BFF crash cause found:** the debug `/api/overview` route parses **171MB of JSONL per request**, polled every 5s per tab (`relationshipSummary` reads every timeline in full). Cache it (15-30s TTL) or keep everyone off `/debug` routes.
- **No backups of anything.** `pg_dump` (oniondao + nullcity_city) + tar of `data/controller/memory` before doors, then hourly. ~5 lines of shell.
- Controller supervision is good (3s restart, lock-clearing, fast-crash guard). Inference ceiling: `maxConcurrent: 2` at 3-8s/call ≈ 0.25-0.6 brain decisions/sec citywide — humans will feel "slow residents," not crashes.

## Product: will humans participate?

**The pitch (a stranger's one sentence):** *"Adopt a tiny AI villager living — and eventually dying — inside old-school RuneScape: your Onions keep them alive, and in return they learn your name, write you letters, and carry you into the story of their life."*

**Yes-case:** real stakes (real scarcity, inspectable cognition, permadeath), the proven tamagotchi-care engine with the strongest-ever version (the creature actually thinks/remembers/dies), being-known as the killer payoff, RuneScape nostalgia as the hook.
**No-case (current surface):** support is a button into a void (no reaction, no runway framing); letters are faction-keyed templates (compare-with-a-friend = authenticity collapse); no third act (immortality); ~83% of a real inbox is identical broadcast spam; nothing pulls anyone back tomorrow.

**The current dashboard reads as a billing console** ("Onions are what you spend. Attention is what residents receive" / "Confirm Spend" / receipt: "attention rose from 2437 to 2537"). The data to fix this exists — it's surfacing + copy, not building.

**Top 5 <1-day product improvements (impact-ordered):**
1. Make the support moment a moment: runway language ("you gave Hans ~2 more days"), attention bar animation, resident's latest say as "reaction," "Hans will write to you." (`end-user-dashboard.ts:484`, `App.svelte`)
2. Rewrite surface copy in the product's voice; put the pitch on the door.
3. Un-hide Library portraits on resident cards (flip `expertOnly`) so strangers can CHOOSE someone.
4. Letters re-keyed to the resident (HR-1 copy shipped in `e778e04f` but zero sends yet — it lands with bring-up).
5. Curate the cast: heroes online (MVP-2), axe pre-seed (MVP-8), trim test souls (HR-7 fence — 595 test souls one readdir from a public epitaph), unread-letters badge.

## DESPERATE QUESTIONS — need James, cannot be guessed

| # | Question | Default-if-undecided | Cheapest answer |
|---|---|---|---|
| Q1 | **Real burn or stand-in tomorrow?** | Key is set → REAL burns happen | 15-min decision + one MVP-9 smoke in chosen mode tonight |
| Q2 | **One-click silent spend or explicit consent?** | Silent spend ships | One sentence; if one-click → add confirm dialog (hours) |
| Q3 | **Can anyone die on day 1 — who?** | Accidental immortality wins | Pick: "fading banners only" vs "2-3 mortal souls, cohort = the cap" |
| Q4 | **Expected concurrent humans?** | Unknown; semaphore=2 citywide | Get the number; run a 10-tab + 2-client load smoke |
| Q5 | **Letter cadence cap before spam?** | ~47/recipient already | Set conservative cap (e.g. 3/day/patron), read day-1 data |
| Q6 | **Will a stranger get it in 10s?** | Hypothesis | Show 3 people the homepage for 10s tonight |
| Q7 | **Do attendees arrive with Onions?** | SL-1 Solana throw can kill check-in faucet | ONE full cold-path rehearsal: signup → check-in → see onions → support |

## RELEASE PLAN

### Tonight — decisions (James, ~30 min): Q1, Q2, Q3 above. Everything else can proceed without you; these three cannot.

### Tonight — code (farm in parallel; all small)
| Task | Owner-lane | Size |
|---|---|---|
| SEAM-1 recognition fix (`creditAttention` → patron_gift event) | server agent | ~20 LOC + tests |
| SEAM-3a un-gate Inbox nav + SEAM-3b repoint Soul Library to `/v1/graveyard` | dashboard agent | small |
| Consent confirm dialog (if Q2 = one-click) | dashboard agent | hours |
| Support-moment payoff card + copy pass + portraits on cards | dashboard agent | ~½ day |
| Plea strict-floor 1-liner; mortal-cohort frontmatter (per Q3) | server agent | small |
| HR-7 test-soul fence + MVP-2 heroes + MVP-8 axe seed | Codex | config |
| SL-6 disable AP/GP exchange in prod; SL-1 Solana-throw defuse (landing) | Codex / Dev | small |

### Tonight — ops (Codex/ops)
1. **Verify inference reachable** (`curl inf.nullcity.ai:1234/v1/models` → 200) — gate for everything.
2. `npm run build` (dist is 6 days stale) + decide ship branches (server `agents/wip`, dashboard+landing `wip/spec`).
3. Supervise the BFF (clone controller supervisor pattern, no `--watch`); add landing to start-all.
4. Set `ONION_CALLBACK_SECRET` + prod env per money-path checklist; backups (pg_dump + memory tar) + hourly cron; healthcheck cron (idempotent re-run of start-all); OrbStack + start script in login items; move runtime logs out of `/tmp`.
5. Cache or fence `/api/overview` (171MB/req debug route).

### Tomorrow morning — bring-up + rehearsal
1. Ordered bring-up: OrbStack → Postgres → inference check → build → `start-all-supervised.sh` → landing → seed → smoke (sequence documented in SRE report).
2. **ONE full cold-path rehearsal as a fresh user** (signup → check-in → onions → choose → support → reaction → letter). This single walk catches most remaining failure modes.
3. Load smoke: 10 tabs public routes + 2 game clients, 10 min, watch BFF RSS.
4. Staff brief: the no-refund loss mode + `attention_grant_intents` re-drive procedure; keep eyes off `/debug` routes.

### Explicitly NOT for tomorrow (post-launch, by design)
HR-2 daily digest/email (the retention engine — top post-launch priority), HR-4 reply-to-letter (0 live sends; don't ship unverified), HR-8 second-encounter greeting, NCRI/prints/trophies, full player login (relabel button "Watch in RuneScape" if unproven).
