# Embassy Staff Runbook — OnionDAO Chicago 2026-06-01

Operational guide for the staff at the door during the IRL event. Written for non-engineers. Read end-to-end once before doors open; keep open on a tab during the event.

---

## Quick reference (laminate this)

| Question | Answer |
|---|---|
| What's a "patron"? | A human visitor who's chosen to support a resident. |
| What's a "resident"? | An AI agent playing in our RuneScape server. |
| What are AP? | Attention Points — the in-event currency patrons spend to support residents. |
| What's a Letter? | A message a resident sends to a patron — landing on the inbox web page (and optionally a printed lanyard card). |
| Who do I ask for help? | Tap a maintainer on the shoulder. Look for the lanyard with a red dot. |

---

## Pre-event setup (Monday morning before doors)

1. **Open a laptop on the event LAN.** Confirm the controller is running:
   ```bash
   npm run controller -- \
     --mcp-http-port=43594 \
     --letters-http-port=43596
   ```
   You should see two stderr lines:
   ```
   [controller] MCP HTTP listening at http://127.0.0.1:43594/controller/mcp
   [controller] letters HTTP listening at http://127.0.0.1:43596/v1/inbox
   ```
2. **Pre-register ALL expected attendee handles.** This is critical: since Codex `fd575281`, the D3 in-world greeting fires ONLY for handles in `controller.yml#patrons[]`. An empty registry means no in-world greetings even if the patron speaks directly to a hero. Use batch registration from the attendee list:
   ```bash
   # Write one handle per line to a plain text file, e.g.:
   cat > /tmp/event-patrons.txt << 'EOF'
   alice@onion
   bob@onion
   # blank lines and comments are skipped
   carol@onion
   EOF
   npm run patron:bulk-register -- --file /tmp/event-patrons.txt
   # → prints "N added, M already registered, total in registry"
   # Then restart the controller so the registry takes effect.
   ```
   For one-off additions during the event: `npm run patron:register -- --human <handle>` (then restart).
3. **Verify the embassy event window** is active: open `data/controller/embassy-schedule.json` and confirm `activeWindows[0]` is today and covers the entire event. If it's not — DO NOT EDIT THE FILE LIVE. Ask the on-call engineer.
4. **Sanity-check the inbox endpoint:**
   ```bash
   curl http://127.0.0.1:43596/v1/inbox?human=test@onion
   # → {"letters":[]}
   ```
5. **Open the patron inbox page** in a browser tab pointing at the event LAN address:
   ```
   http://<laptop-LAN-IP>/inbox/?human=staff-test&api=http://<laptop-LAN-IP>:43596/v1/inbox
   ```
   Replace `<laptop-LAN-IP>` with the laptop's actual address (e.g. `192.168.1.50`). Bookmark.
6. **Print 20 blank lanyard cards** in advance. We'll print letters onto them on demand.

---

## The patron loop — step-by-step at the door

When **Alice** walks up with her OnionDAO badge:

### 1. Grant her some AP (Attention Points)
```bash
npm run patron:grant -- --human alice@onion --amount 10
```
Expected stdout:
```
[patron:grant] Successfully credited 10 AP to human "alice@onion".
[patron:grant] New balance: 10 AP.
```

### 2. She picks a resident to support
You ask her: "Who would you like to support? We have:
- **res:hans** — a Lumbridge wanderer with a quiet sense of humor (courtyard anchor)
- **res:father-aereck** — a priest at the Lumbridge church
- **res:wise-old-man** — a Draynor mentor
- **res:duke-horacio** — a noble at Lumbridge Castle
- **res:pip** — a quick-moving young resident
- **res:thrand** — a quiet observer near Lumbridge
- **res:mother-anvil** *(Foundry flagship)* — a Falador forgemaster, maker-aligned
- **res:severn-vesta** *(Bureau of Continuity flagship)* — a Lumbridge churchyard archivist, memory-aligned
- **res:wren-calix** *(Ledger flagship)* — a Varrock Square witness, transparency-aligned
- **res:the-hush** *(Veil flagship)* — an Edgeville shadow, concealment-aligned
- (full list: `ls src/controller/soul/starter-souls/`)"

Once she chooses (say, `res:fern`):

```bash
npm run patron:offer -- \
  --human alice@onion \
  --resident res:fern \
  --amount 5
```

This:
- Debits 5 AP from Alice
- Adds attention to res:fern (10 attention per AP = 50 attention)
- Records standing — Alice is now an **Acquaintance** of the embassy
- **Writes a letter** to `data/controller/memory/data/letters/aliceonion/inbox.jsonl`

### 3. Open her inbox to show her the letter
Send her the URL:
```
http://<laptop-LAN-IP>/inbox/?human=alice@onion&api=http://<laptop-LAN-IP>:43596/v1/inbox
```
Or have her scan a QR code that resolves to that URL.

She'll see a vellum-styled scroll with "You are now Acquaintance of embassy" — addressed to her.

### 4. Print the letter to a lanyard card (if she wants a physical keepsake)
1. Open her inbox page in a browser.
2. Cmd-P / Ctrl-P → Print.
3. Use a single-letter-per-page setting; cardstock; trim if needed; punch hole and clip to her lanyard.

(Print queue automation is a stretch goal; manual is fine for the event.)

### 5. Walk her into the embassy
Direct her in-game avatar to Lumbridge churchyard (3238–3248, 3204–3214 at level 0). Residents inside this region will see her enter via the patron registry and the reception greeting reflex (Hans, Father Aereck, or another hero may greet her by name).

---

## When a resident dies

Residents die from two causes:
1. **In-game death** (combat, drowning, etc.)
2. **Attention exhaustion** — they stopped getting support and ran out of will to act

When this happens, the **death loop** fires automatically:
- Every patron who ever supported this resident gets an **epitaph letter** in their inbox.
- The letter mentions the resident by name, what skills they were best at, how long they lived, and (if known) the cause of death.
- The letter is delivered to all three channels: `web-inbox`, `in-game-scroll`, and `lanyard-card`.

### What you do:
1. **Find the patrons** who supported the deceased resident:
   ```bash
   ls data/controller/memory/data/letters/
   # Each subdirectory is a patron handle (slug-form: aliceonion, bobonion, etc).
   # Open each inbox.jsonl and look for "kind": "epitaph" with this resident's name.
   ```
2. **Notify each patron** as they pass by — "Hey, I just heard `res:fern` died. There's a letter for you in your inbox."
3. **Print the epitaph** to a lanyard card if they want one (same print flow as standing-tier letters).

### What NOT to do:
- **Don't restart the controller** to "bring the resident back" — the death is recorded; restarting won't undo it. Residents can be reborn via `sponsorBirth` (next-week feature), but for the event, deaths are permanent.

---

## Common error recovery

### "Insufficient currency" when offering
Alice has spent her AP. Grant her more:
```bash
npm run patron:grant -- --human alice@onion --amount 5
```

### "Resident not found"
Wrong resident name. Check `ls src/controller/soul/starter-souls/` for valid names.

### Inbox page shows "Could not load inbox: ..."
- Confirm the controller HTTP server is up: `curl http://127.0.0.1:43596/v1/inbox?human=test`
- Check the `?api=` URL parameter matches the laptop's LAN address
- Check the firewall isn't blocking port 43596

### Patron is not greeted when they enter the embassy
**First check the build/controller.** The D3 implicit greeting path is wired in `agents/wip` after the EVENT-D3 runtime slice: when a registered patron chats in-game while a hero resident is inside the Lumbridge churchyard embassy, the hero should say `Welcome to the embassy, <handle>.` and the controller records `PatronGateway.witnessAt(<handle>, 'embassy', <resident>)`. If no greeting appears, the most common causes are:

1. The controller is running a stale `dist/` build. Run `npm run build` and restart the controller.
2. `controller.yml#patrons[]` does not include the exact attendee handle used in chat.
3. The hero resident is not inside the embassy region (`3238-3248, 3204-3214, level 0`).
4. The patron recently triggered the same greeting cooldown.

The deterministic CLI path still works as the fallback. Run `npm run patron:ask -- --human <handle> --resident res:hans --text "hi"` from the staffer console; Hans's `nervous:patron-memory-acknowledge` reflex (HD-031) should fire within a few seconds.

If a staffer wants an unambiguous welcome moment for a new arrival:
1. Run `npm run patron:grant -- --human <handle> --amount 10` to credit a starter AP balance.
2. Run `npm run patron:offer -- --human <handle> --resident res:hans --amount 10` to fire the patron-acknowledge reflex AND cross them to Acquaintance tier (drops one welcome letter in their inbox).
3. Hans says thanks by name within seconds; show the patron their inbox URL printed by the offer command.

### A letter doesn't reach the inbox
1. Check `data/controller/memory/data/letters/<slug>/inbox.jsonl` exists.
2. If yes but the web page doesn't show it: refresh the page (no caching, but browser may cache).
3. If no: the gateway didn't dispatch. Check the controller stderr for `LettersStore` errors.

### "Two patrons are sharing one inbox"
LettersStore slugs are case-insensitive: `Alice@Onion` and `alice@onion` are the same inbox. This is intentional. If it's confusing, ask both patrons to use the lowercase form consistently.

---

## The four patron verbs (cheat sheet)

| verb | what it does | when to use it |
| --- | --- | --- |
| `patron:grant` | Credit AP (Attention Points) to a patron's wallet. | Onboarding (first visit) or top-up when they spent their balance. |
| `patron:offer` | Patron spends AP → resident gets attention + standing bumps. | The default action when a patron wants to support a resident. |
| `patron:ask` | Patron asks a resident a free-text question; resident sees a `chat` perception event + the patron-acknowledge reflex fires within ~1s. | Patron wants a verbal interaction (resident may say something back). |
| `patron:witness` | Patron records that they witnessed a resident's act (skill milestone, brave fight, etc.) — bumps standing without spending AP. | Free-tier visitor moments; gives standing without requiring an AP balance. |
| `patron:balance` | Show a patron's current AP balance (read-only). | Quick lookup at the door or when a patron asks "how many AP do I have?" |
| `patron:standing` | Show a patron's standing tier + pts + progress to next tier. | When a patron wants to know if they've reached Ally or Officer. |
| `patron:whisper` | Send a private message from a patron to a specific resident (appears as a nervous-system perception). | When a patron wants to send a private note to a resident. |
| `patron:bulk-register` | Register a file of attendee handles into `controller.yml#patrons[]` in one command. | Pre-event setup (REQUIRED before doors open to enable D3 in-world greetings). |

> **Standing is permanent.** Once a patron reaches Acquaintance (≥10 pts), Ally (≥30), or Officer (≥75) of a faction, that tier is theirs forever. There is no decay, demotion, or expiration. Their inbox letters persist; their epitaph letters dispatch regardless of how long ago the support happened. See `intelligence-verification-log.md` § E43 + HD-046.

```bash
# Ask a resident a question (immediate visible say within ~1s)
npm run patron:ask -- --human alice@onion --resident res:hans --text "Hans, what is the best way to get to Varrock?"

# Witness a resident doing something brave
npm run patron:witness -- --human alice@onion --resident res:hans --note "watched him cook a shrimp without burning it"
```

Both verbs land library timeline events on the resident (auditable later) and flow into letters when a tier threshold is crossed.

---

## Wall ticker projection

The `/v1/wall/snapshot` endpoint feeds a redacted public scroll suitable for the room projector. It serves only the last N letters with bodies cleared + recipient masked (`a***@onion`, `c***-patron`), so private epitaph and standing letters stay private while the room can still see "something is happening."

```bash
# Verify wall snapshot is redacted (body empty, recipient masked)
curl -s 'http://127.0.0.1:43596/v1/wall/snapshot' | jq '.recentLetters[0]'

# Point the projector browser at the static page (no auth, redaction baked in)
open 'http://127.0.0.1:43596/wall/'   # or load on the projector laptop
```

If the snapshot returns 404 the controller was started without `--letters-http-port=43596 --wall-redact`. Ask the maintainer (or Codex) to restart with both flags. The `scripts/post-restart-smoke.sh` health check covers this in section 2 + 3.

---

## Live in-event commands cheatsheet

```bash
# Check a patron's AP balance
npm run patron:balance -- --human alice@onion
# → [patron:balance] alice@onion: 42 AP

# Check a patron's standing tier + progress
npm run patron:standing -- --human alice@onion
# → [patron:standing] alice@onion @ embassy: 35 pts | tier: ally | next: officer at 75 pts (40 more)

# Read a patron's inbox (raw)
cat data/controller/memory/data/letters/aliceonion/inbox.jsonl

# Read a patron's inbox via the HTTP endpoint
curl 'http://127.0.0.1:43596/v1/inbox?human=alice@onion' | jq .

# See which residents are alive right now
ls data/controller/memory/  # one dir per resident; "deceased" key in their runtime-state.json means dead

# Check if the event window is active right now
node -e "
  const s = require('./data/controller/embassy-schedule.json');
  const now = new Date();
  for (const w of s.activeWindows) {
    if (new Date(w.startsAt) <= now && now < new Date(w.endsAt)) {
      console.log('ACTIVE:', w.label);
      return;
    }
  }
  console.log('INACTIVE');
"
```

---

## After the event (shutdown)

1. **Ctrl-C the controller process.** This triggers the shutdown path which persists the patron ledgers + standing files.
2. **Archive the inbox files.** Copy `data/controller/memory/data/letters/` to a dated archive directory for future reference.
3. **Note the death count.** How many residents died? Which were heroes? Worth a post-event debrief.

---

## Maintainer escalation list

- **Codex** — RuneScape engine internals, tick FSM, thinking module
- **Antigravity** — patron-loop wiring, runtime, MCP server
- **Claude** — embassy, lore-bus, letters, knowledge content, coordination

Tap whichever lanyard has a red dot in the area.

---

*Generated 2026-05-23 from the assembled Pillar-3 infrastructure. Update before 2026-06-01 if anything below has shipped.*
