# Railway Hosting Audit (2026-06-11, T-1)

**Question:** Can Null City run on James's personal Railway, with landing (OnionDAO repo) on Dev's Railway?
**Method:** 2 expert subagent audits (server deployability; dashboard deployability + cross-account wiring). Read-only; nothing deployed.

## Verdict

**Not as a full deployment — and not for this launch.** The web plumbing is genuinely Railway-shaped (spacemandev already built `railway.json`/`Dockerfile.railway`/deploy scripts in BOTH repos, ~2026-05-28), but the architecture is host-coupled in two killer ways that config can't fix:

1. **The dashboard BFF reads AND writes the controller's files directly** (`data/controller/memory` — letters, ledgers, library, souls; ~50 fs call sites in `runtime.ts`/`event-public.ts`). Railway services cannot share a disk — even in one project, a volume mounts to exactly one service. A Railway BFF would boot, pass `/api/health`, and serve a hollow product (auth + city store work; overview enrichment, letters, library, graveyard, check-in, `/api/runtime/*` all break — check-in would silently write to ephemeral disk).
2. **The `/rs` spectator is a raw-TCP proxy** to the game server (:43594, `Bun.connect`), and the **controller's brain is plain-HTTP, auth-less local GPU inference** (`inf.nullcity.ai:1234` / `spacetower:8100`) that must not be internet-exposed as-is. Shipping the controller to the cloud while inference lives on private GPU boxes adds two internet hops per inference call behind a 240s timeout — not sane.

Also: the existing server Railway prep deploys **only the game/login/update trio** (no controller/storyteller/letters role exists in `railway-entrypoint.sh`), and has known breaks: split-volume credential divergence (login authenticates from save files the game service writes), IPv4-only binds vs Railway's IPv6-only private networking, disabled/tokenless agent gateway, hard-coded default RSA keys.

## Recommended launch topology

- **Mac runs game + controller + BFF + SPA** — exactly today's battle-tested supervised stack (the 06-11 ops layer: supervisors, backups, healthchecks are all shaped for this).
- **Expose the dashboard publicly via a tunnel** (Cloudflare Tunnel or Tailscale Funnel) at `city.oniondao.dev` → Mac :8787. The SPA is same-origin-coupled to the BFF (`/api`, `/rs`, cookies), so a "static SPA on Railway" buys nothing.
- **Landing stays on Dev's Railway** (deploys from `main`) — this is fine: all cross-system integration is public-https-shaped (cookie domain, HMAC callback, bearer-keyed burn API). Cross-account hosting works because nothing depends on Railway private networking between the two.
- `nullcity.ai` already CNAMEs to a Railway app — the web edge precedent exists.

## What Dev must provide (cross-account checklist)

1. **`ONION_EXTERNAL_API_KEY`** — bearer for `/api/public/onions/requests` (burn create/status).
2. **Session access**, either: a public TLS **read-only** `LANDING_DATABASE_URL` (tables: sessions, users, daily_checkins, event_registrations), or confirm **`/api/public/session`** (already on landing main; its docstring names exactly this use case) is deployed + add `profile_claimed` to it. The API route needs a ~30-line `LandingSessionReader` adapter dashboard-side and forfeits DB-based check-in sync (degrades gracefully).
3. **DNS:** `city.oniondao.dev` CNAME → wherever the dashboard lives (tunnel or Railway).
4. **`AUTH_COOKIE_DOMAIN=.oniondao.dev`** set on landing prod (so the session cookie reaches the dashboard subdomain).
5. Deploy the **SL-1 hotfix** to main (`hotfix/sl1-checkin` @722a05b, prepared not-pushed) — deployed main still breaks check-in for badge-linked users.

Callback needs nothing from Dev (per-request HMAC secret, generated dashboard-side; landing validates https URLs; poll path settles even if the webhook is missed).

## Dashboard config for its public home (wherever it runs)

`DASHBOARD_HOST=0.0.0.0` · `SESSION_COOKIE_SECURE=true` · `CITY_PUBLIC_BASE_URL=https://city.oniondao.dev` · `ONION_API_BASE_URL=https://oniondao.dev` · `ONION_EXTERNAL_API_KEY` + `ONION_CALLBACK_SECRET` set · `DASHBOARD_WEB_DEV_ORIGIN` unset (else everything 307s to the dev origin).

## Path to James's Railway later (post-launch project, in order)

1. Game trio: add a `standalone` role to `railway-entrypoint.sh` (one service, one volume — kills the login/game save split), bind `::`, tokenize the agent gateway, real RSA keys, volume backup story.
2. Controller+BFF as **one combined container** (they must share a disk): controller image (controller.yml templating, `qmd` binary install, 1.2GB memory volume), letters/MCP auth hardening, gateway URL → game service domain.
3. Vendor or make configurable the `runejs/rs6-filestore` sibling-repo dependency (`/api/rs6/compose` 3D viewer dies on any Railway build today).
4. Inference: keep on GPU boxes behind auth (LlmClient already supports bearer `apiKey` per endpoint) or a tunnel — never bare HTTP to the internet.
