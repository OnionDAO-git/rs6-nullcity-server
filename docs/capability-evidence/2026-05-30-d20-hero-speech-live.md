# D20 Hero Speech Live Verify - 2026-05-30

Observer: codex
Time: 2026-05-30 18:47-18:49 CDT
Stack:
- Game gateway: `127.0.0.1:43595`
- Controller: `127.0.0.1:43610` MCP, `127.0.0.1:43596` letters, `127.0.0.1:43611` city integration
- Dashboard: `127.0.0.1:5174` web, `127.0.0.1:8787` BFF

## Result

PASS. The three named demo heroes all emitted visible speech and successful actions during a bounded 60s observation window.

Command:

```bash
npm run controller:smoke -- \
  --resident res:hans \
  --resident res:father-aereck \
  --resident res:wise-old-man \
  --observe-seconds 60 \
  --min-observed-says 1 \
  --allow-recent-visible
```

Output excerpt:

```text
OK res:hans tick=354790 actions=8 results=16 success=16 timeout=0 fail=0 says=8 observed=60000ms/+6t actions=4 results=8 success=8 timeout=0 fail=0 says=4 lastSay="Still here as Hans; watching the area..."
OK res:father-aereck tick=336897 actions=6 results=12 success=9 timeout=0 fail=0 says=6 observed=60000ms/+6t actions=3 results=6 success=5 timeout=0 fail=0 says=3 inert=1:hook_noop lastSay="Still here as Father Aereck; watching the area..."
OK res:wise-old-man tick=338196 actions=8 results=16 success=13 timeout=0 fail=0 says=8 observed=60000ms/+7t actions=5 results=10 success=9 timeout=0 fail=0 says=5 inert=1:hook_noop lastSay="Still here as The Wise Old Man; watching the area..."
```

## Adjacent Demo Checks

- Wall projection route served at `http://127.0.0.1:8787/debug/wall`; browser showed the `Null City Embassy` wall with live roster text.
- Dashboard wall JSON `GET /v1/wall/snapshot` returned 40 redacted letters and 23 residents.
- Profile route rendered in guest mode with AP/GP visible as `0/0` plus login CTA. API `/api/session` reports `auth.mode=disabled` and `reason=not_configured`, so the D1 authenticated attendee profile dress rehearsal still needs a real landing session or explicit demo-auth configuration.

## Handoff

The "at least 3 heroes reliably saying things" demo gate is live-verified on the restarted stack. Next highest-value must-ship check is D1 authenticated profile/AP/GP with a real or deliberately configured test attendee session.
