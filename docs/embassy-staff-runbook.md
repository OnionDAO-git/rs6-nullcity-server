# Embassy Staff Runbook — OnionDAO Chicago 2026-06-01

Operational guide for the staff at the door during the IRL event. Written for non-engineers. Read end-to-end once before doors open; keep open on a tab during the event.

---

## Quick reference (laminate this)

| Question | Answer |
|---|---|
| What's a "patron"? | A human visitor who's chosen to support a resident. |
| What's a "resident"? | An AI agent playing in our RuneScape server. |
| What are Shards? | The in-event currency patrons spend to support residents. |
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
2. **Verify the embassy event window** is active: open `data/controller/embassy-schedule.json` and confirm `activeWindows[0]` is today and covers the entire event. If it's not — DO NOT EDIT THE FILE LIVE. Ask the on-call engineer.
3. **Sanity-check the inbox endpoint:**
   ```bash
   curl http://127.0.0.1:43596/v1/inbox?human=test@onion
   # → {"letters":[]}
   ```
4. **Open the patron inbox page** in a browser tab pointing at the event LAN address:
   ```
   http://<laptop-LAN-IP>/inbox/?human=staff-test&api=http://<laptop-LAN-IP>:43596/v1/inbox
   ```
   Replace `<laptop-LAN-IP>` with the laptop's actual address (e.g. `192.168.1.50`). Bookmark.
5. **Print 20 blank lanyard cards** in advance. We'll print letters onto them on demand.

---

## The patron loop — step-by-step at the door

When **Alice** walks up with her OnionDAO badge:

### 1. Grant her some Shards
```bash
npm run patron:grant -- --human alice@onion --amount 10
```
Expected stdout:
```
[patron:grant] Successfully credited 10 Shards to human "alice@onion".
[patron:grant] New balance: 10 Shards.
```

### 2. She picks a resident to support
You ask her: "Who would you like to support? We have:
- **res:fern** — a young woodcutter learning firemaking
- **res:hans** — a Lumbridge wanderer with a quiet sense of humor
- **res:wise-old-man** — a Draynor mentor
- **res:father-aereck** — a priest at the Lumbridge church
- (etc — list from `ls src/controller/soul/starter-souls/`)"

Once she chooses (say, `res:fern`):

```bash
npm run patron:offer -- \
  --human alice@onion \
  --resident res:fern \
  --amount 5
```

This:
- Debits 5 Shards from Alice
- Adds attention to res:fern (10 attention per Shard = 50 attention)
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
Alice has spent her Shards. Grant her more:
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
The reception greeting is a substrate behavior — it only fires when:
- The resident is **inside** Lumbridge churchyard
- The patron's handle is in **the patron registry** (configured in `controller.yml`)
- A patron-from chat event arrives in the resident's perception

If none of these conditions fires, no greeting happens. **This is expected behavior, not a bug.** Tap a maintainer if you need a hero to greet a specific patron deliberately.

### A letter doesn't reach the inbox
1. Check `data/controller/memory/data/letters/<slug>/inbox.jsonl` exists.
2. If yes but the web page doesn't show it: refresh the page (no caching, but browser may cache).
3. If no: the gateway didn't dispatch. Check the controller stderr for `LettersStore` errors.

### "Two patrons are sharing one inbox"
LettersStore slugs are case-insensitive: `Alice@Onion` and `alice@onion` are the same inbox. This is intentional. If it's confusing, ask both patrons to use the lowercase form consistently.

---

## Live in-event commands cheatsheet

```bash
# Check a patron's balance
npm run patron:grant -- --human alice@onion --amount 0  # 0 amount = balance check

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
