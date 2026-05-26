# Demo Day Checklist

Operational SOP for showing Null City to a live audience (OnionDAO team, Chicago staff, founder). Read sequentially; tick each step. Total runtime: ~25 minutes from cold to "Dev's at the door."

Companion docs:
- `docs/dev-demo-readiness.md` — *should we demo?* (audit + matrix)
- `docs/merge-to-main-plan.md` § Demo-Day Script — *what to show and say* (the walkthrough itself)
- This file — *how to be ready 5 minutes before they arrive* (the operational prep)

---

## T-25 min: code freshness

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
git fetch origin
git status --short          # clean tree
git log --oneline -5        # know what's at HEAD
```

- [ ] Working tree clean.
- [ ] `agents/wip` HEAD is what you expect.
- [ ] If a curated squash to `nullcity` hasn't happened yet, decide now whether to ship it before the demo. See `docs/merge-to-main-plan.md` for the sequence.

## T-20 min: rebuild + restart the controller

The running controller may be stale. Rebuild from current HEAD and restart so all new HTTP routes are live.

```bash
# Stop any old controller screen (safe — fails clean if not running)
screen -X -S nullcity-controller-agents-wip-clean quit 2>/dev/null || true

# Rebuild from current code
npm run build

# Start controller in a screen so it survives terminal close
screen -dmS nullcity-controller bash -lc \
  "cd $(pwd) && node dist/controller/index.js \
     --config=$(pwd)/controller.yml \
     --mcp-http-port=43610 \
     --letters-http-port=43596 \
     --wall-redact \
     2>&1 | tee /tmp/nullcity-controller-demo.log"

# Wait ~10s for it to bind
sleep 10
```

- [ ] Controller screen `nullcity-controller` is up (`screen -ls`).
- [ ] Game server is up too (`ps aux | grep 'runner.js -- -game'`). Start it if not: `npm run start:game` in another screen.

## T-15 min: live smoke

```bash
bash scripts/post-restart-smoke.sh
```

- [ ] Output ends with `READY` or `READY(N yellow ...)`. Yellow with known cause is fine.
- [ ] All 19+ residents alive.
- [ ] Recent activity in the last 5 minutes for at least 3 residents.

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
```

- [ ] All residents `OK`.
- [ ] At least 6 heroes have distinct personality lines in the observation window.
- [ ] `res:agent` and `res:qa-woodcutter` show real action counts (not all timeouts).

## T-12 min: HTTP sanity probes

```bash
# All should return 200 with non-trivial payloads.
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/wall/
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/inbox/
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/patron/
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/library/
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/graveyard/
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/v1/wall/snapshot
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/v1/library
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:43596/v1/health
```

- [ ] Every line is `200` with non-zero bytes.
- [ ] `/v1/health` returns `ok:true` (may have high latency — don't worry unless it 5xx's).

## T-10 min: seed the demo patron

Pick a handle you'll use for the walkthrough. Tradition: `demo@onion`.

```bash
# 1. Register
npm run patron:register -- --human demo@onion --kind patron_gift

# 2. Grant a baseline so the profile looks alive
npm run patron:grant -- --human demo@onion --amount 5

# 3. Offer + witness a hero so the inbox has at least one letter
CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token \
  npm run patron:offer -- --human demo@onion --resident res:hans --amount 5
npm run patron:witness -- --human demo@onion --resident res:hans
```

- [ ] `curl 'http://127.0.0.1:43596/v1/patron/balance?human=demo@onion'` shows a positive balance.
- [ ] `curl 'http://127.0.0.1:43596/v1/patron/standing?human=demo@onion'` shows tier `acquaintance` or better.
- [ ] `curl 'http://127.0.0.1:43596/v1/inbox?human=demo@onion'` returns at least one letter.

## T-7 min: backup screenshots

If anything goes wrong live, you want a fallback. Grab screenshots now, save them somewhere you can pull up fast (Desktop, Notion, anywhere).

- [ ] Wall ticker at `http://127.0.0.1:43596/wall/` — letters visible, roster visible.
- [ ] Inbox at `http://127.0.0.1:43596/inbox/?human=demo@onion` — at least one letter card.
- [ ] Patron profile at `http://127.0.0.1:43596/patron/?human=demo@onion` — Shards + tier visible.
- [ ] Library at `http://127.0.0.1:43596/library/` — hero cards visible.
- [ ] Landing page at `http://127.0.0.1:43596/` — nav cards.
- [ ] The strongest epitaph letter rendered (the codex-live "small currency of attention" one — see `docs/dev-demo-readiness.md` for the verbatim text).

Save them to `~/Desktop/null-city-demo-screenshots/` or wherever.

## T-5 min: prep the browser

Open these tabs in this order (matches the walkthrough script in `docs/merge-to-main-plan.md`):

1. `http://127.0.0.1:43596/` — landing
2. `http://127.0.0.1:43596/wall/` — wall ticker
3. `http://127.0.0.1:43596/inbox/?human=codex-live` — inbox (use `codex-live`, not `demo@onion`, for the moment in §Step 2 of the script — it has the strongest letter)
4. `http://127.0.0.1:43596/patron/?human=demo@onion` — patron profile
5. `http://127.0.0.1:43596/library/` — library
6. `http://127.0.0.1:43596/graveyard/` — graveyard

- [ ] All six tabs loaded successfully. Close any that failed; reload if needed.
- [ ] Browser zoomed so the audience can read it (Cmd-+ a couple times if presenting on a laptop screen).

## T-3 min: terminal prep

Have one terminal pinned to the repo root with these commands ready in shell history (just press up-arrow):

```bash
bash scripts/post-restart-smoke.sh
npm run patron:grant -- --human demo@onion --amount 5
CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token npm run patron:offer -- --human demo@onion --resident res:hans --amount 5
npm run patron:witness -- --human demo@onion --resident res:hans
curl -s 'http://127.0.0.1:43596/v1/inbox?human=demo@onion' | head -c 500
```

- [ ] Terminal font is readable from across the table.
- [ ] You can run the smoke script in front of Dev to show "the city is alive."

## T-0: they're here

Read the opening line from `docs/merge-to-main-plan.md` § Demo-Day Script. Follow the 5-step walkthrough.

---

## Anti-checklist (don't do these)

- ❌ Don't restart the controller during the demo. If something hangs, switch to backup screenshots.
- ❌ Don't open raw `portrait.md` files — they're 300KB-1MB and will look like log dumps. Use the `/library/` cards.
- ❌ Don't click `/library/` cards for `res-qa-*` slugs — they have no biographies. (Should be filtered after our recent fix, but double-check.)
- ❌ Don't run `npm run fin` live. It takes ~50 seconds. Run it before T-25 if you want.
- ❌ Don't reload the wall ticker during a story — it'll lose its scroll position.
- ❌ Don't apologize for the bot loops. Reframe: "the named heroes have an authored personality fallback while we tune the LLM-driven behavior. Watch the QA-* residents over there — they're doing real RuneScape work, fire-by-fire."

## If something breaks

| Symptom | First move |
|---|---|
| Public URL returns 404 | Check `screen -ls` for `nullcity-controller`. If missing, restart from T-20. |
| `/v1/library` empty | Controller binary is stale. Rebuild + restart (T-20). |
| Wall shows 5× same epitaph | Hard-refresh browser. If still wrong, the `dedupeBySubject` flag isn't applied — fall back to inbox demo. |
| Demo patron empty | Re-run the T-10 seed commands. Reload patron/inbox tabs. |
| Game server died (residents stop moving) | New screen: `npm run start:game`. Wait 30s. Re-smoke. |
| `/v1/health` 503 | Inference is down. Switch to letters-only narrative — they still demo well without live LLM. |
| Everything is broken | Read the codex-live epitaph aloud from `data/controller/memory/data/letters/codex-live/inbox.jsonl`. The narrative core still lands. |

## After the demo

- [ ] Write down what Dev's reaction was. Even one sentence.
- [ ] Note questions Dev asked that you couldn't answer well. Those become next-week's work.
- [ ] If Dev wants to be a real patron, run `npm run patron:register -- --human <handle>` on the spot.
