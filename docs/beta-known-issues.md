# Null City Beta Known Issues / What Not To Demo

Updated: 2026-06-11 evening CDT.

This is the launch-room cutline for a guided beta. Keep it blunt and current. If an issue is fixed and verified live, remove it or move it to "Safe To Mention As Recently Fixed."

## Current Verdict

Null City is close to a guided beta, but not an unattended/open beta until inference and the human support cold path are green.

Static code health is strong: server and dashboard tests/builds passed on 2026-06-11. The live risk is runtime behavior, especially inference reachability and uneven resident activity.

## Safe To Demo Tonight

| Surface | Demo Confidence | Notes |
|---|---:|---|
| Dashboard home / residents / resident detail | High | Main human surface. Use Simple mode paths. |
| Landing page | Medium | Reachable locally; still verify real auth/support mode before promising money flows. |
| Storyteller / projector narration | High | Fresh OpenRouter Sonnet frame produced during 2026-06-11 review. Good narrative spine. |
| Wall snapshot / public resident story | Medium | Route responds and redacts patrons; some letters are historical. |
| Curated beta cohort | Medium | Use `docs/2026-06-11-launch-beta-cohort.md`; do not show the full 25-resident historical roster as "all live." |
| RuneScape resident view | Medium | Use as "watch/observe"; verify the chosen resident renders before showing live. |
| Deterministic resident skills | Medium | QA/named skill residents can visibly woodcut, fish/cook, scout, survive, and trade better than generic heroes. |

## Do Not Demo / Do Not Claim Yet

| Do Not Show Or Claim | Why |
|---|---|
| "Residents are fully smart autonomous RuneScape players" | Current proof supports curated routines and bounded goals, not arbitrary long-form adventuring. |
| Full 25-resident city | Launch cohort is intentionally 8-10 residents; many historical/test residents are offline, noisy, or not launch-polished. |
| Inference-backed intelligence while `/v1/health` is red | On 2026-06-11 both owned inference URLs timed out from this machine and 14 residents showed inference errors. |
| Arbitrary questing | Cook's Assistant variants are tested in bounded conditions; natural ingredient gathering and arbitrary quest progress are not reliable. |
| NCRI / physical print fulfillment as attendee-ready | Registry/print bridge substrate exists, but automated resident-to-physical-print flow is not launch-safe. |
| AP-for-GP exchange as a public attendee feature | Live config disables it because the exchange is exploit-shaped while onions/AP are scarce. |
| Real Onion spend unless the cold path is rehearsed | Must verify signup/session, approval, burn/stand-in, attention credit, resident recognition, and inbox letter. |
| "Death and legacy are fully proven day-one loops" | Mortality substrate exists, but day-one death/fading/epitaph loop still needs a live rehearsal with mortal cohort members. |
| Debug/admin routes | They expose operational complexity and can be slow/noisy. Keep attendee flow on Simple surfaces. |
| Model benchmarking conclusions | Endpoint/model benchmarking is a later workstream; tonight is about stability and legibility. |

## Known Issues To Say Out Loud If Asked

- Residents are currently better at small, structured jobs than broad human-like plans.
- Some heroes still use repetitive "still here / watching the area" lines when the brain is slow or unavailable.
- The city has deterministic body routines, so it can look alive even when inference is degraded; controller health is the source of truth for brain health.
- Storyteller is strong, but it must be grounded in fresh runtime evidence. Do not use stale story frames.
- Human support is the heart of the product, but real-money/onion spend needs an operator-verified path before open beta.
- The physical-print/NCRI loop is exciting but should be described as upcoming/admin-prototype unless verified end to end.

## Tonight Go / No-Go Checks

Before saying "beta is live," run:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
bash scripts/runtime/healthcheck-nullcity.sh
npm run controller:status --silent
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
```

Required for a guided beta:

- Dashboard BFF, dashboard web, landing, game, controller, and Storyteller screens are running.
- `/v1/health` is not red for inference, or the beta is explicitly framed as degraded/no-brain mode.
- At least 5 curated residents show visible activity in a 60-second smoke.
- Storyteller latest frame is fresh.
- One human support path is verified in the chosen mode: real Onion approval or clearly labeled stand-in.

## If Something Breaks During Demo

| Symptom | Say | Do |
|---|---|---|
| Residents stop thinking | "The body loop is still alive, but the model server is degraded. This is exactly why we track inference separately." | Show Storyteller, Library, dashboard state, and deterministic skill residents. |
| Some residents are offline | "We're beta-testing a curated cohort, not scaling the whole city tonight." | Switch to launch cohort doc and show working residents. |
| Support flow is uncertain | "We have the support loop wired; tonight we are using the verified safe mode rather than risking a bad money path." | Use stand-in/support rehearsal or skip money demo. |
| RuneScape viewer glitches | "The dashboard is the control/readout surface; the client viewer is an observe mode still being hardened." | Return to resident detail, Storyteller, and wall. |
| Storyteller says something stale | "The storyteller is only trusted when marked fresh; stale frames are treated as archive." | Refresh/rebuild Storyteller or skip projector narration. |

## Safe Beta Framing

Use this framing:

> "This is a guided beta of Null City: AI residents living inside RuneScape, with humans giving Attention to keep them alive and shape their stories. The core loops are real, the dashboard and Storyteller are working, and we are now tightening reliability before opening it wider."

Avoid this framing:

> "The agents can autonomously do anything in RuneScape."

