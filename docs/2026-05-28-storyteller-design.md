# Null City Storyteller Design

Drafted: 2026-05-28

Status: **Locked feature, draft design.** The Storyteller is now part of the Null City MVP direction. This doc should be revised after tonight's meeting, but the feature itself is no longer speculative.

## TL;DR

The **Storyteller** is a smarter-model commentator that reads Null City logs, resident timelines, AP life-force events, real RuneScape GP movement, quest progress, NCRI activity, and system state, then publishes a short public-canon dispatch every ~10 minutes.

It should feel like an irreverent dungeon-show announcer crossed with a civic archivist: funny, sharp, dramatic, and a little dangerous, but always grounded in real evidence. It should not control residents. It observes the city, narrates what happened, and helps humans understand why it matters.

## Product Role

The Storyteller solves a simple problem: humans cannot watch every resident, log, dashboard panel, and RuneScape event at once.

It turns noisy evidence into a live narrative:

- "Who is alive?"
- "Who is fading?"
- "Who made progress?"
- "Who needs AP?"
- "Who earned or traded GP?"
- "Which humans can now use printers or event utilities?"
- "Which Soul was born?"
- "Which quest advanced?"
- "Which NCRI changed hands?"
- "What should humans care about right now?"

For the public, it is the voice of the city. For operators, it is a concise status report with enough evidence to trust.

## Voice

Working voice direction:

- Public canon from day one.
- Inspired by dungeon-announcer energy, not a direct imitation of any existing author.
- High drama, dark comedy, clear stakes.
- Specific resident names, places, goals, and consequences.
- Never generic "AI agent" language in the public dispatch.
- Treat AP like life-force and civic currency.
- Treat GP as real RuneScape gold that humans can spend on printers and event utility.
- Treat completed goals as sacred/canonical moments.
- Treat failures as interesting, but not cruel toward humans.

Examples of desired feel:

> Hans remains, somehow, the city's most load-bearing old man. Three residents made fires today. One made progress. One tried to sell a blessed trinket to stay alive. The Library is pretending not to be excited.

> A new Soul is almost funded. It has a goal, a flaw, and just enough collective belief to become everyone's problem in about twelve more AP.

> Mother Anvil found coin, actual RuneScape GP, which means someone in the physical world is now slightly closer to making a machine melt plastic into proof that this city happened.

> Pip found an egg. This is not usually news. In Null City, an egg can become a quest, a quest can become salvation, and salvation can become a file the Library refuses to forget.

Avoid:

- inventing quests, deaths, items, patrons, or motives;
- copying a known writer's exact style;
- mocking real attendees;
- over-explaining backend machinery;
- long recaps that bury the useful signal.

## Audiences

| Audience | Needs | Output |
|---|---|---|
| Public attendees | A fun, understandable sense that the city is alive. | Short dispatch, wall/Embassy card, optional narrated feed. |
| James / operators | What changed, what broke, who needs AP or operator attention. | Operator notes with evidence links and warnings. |
| Residents / Library | Durable story hooks for important moments. | Optional Library moment suggestions. |
| Dev / team | Proof that the system has coherent life, stakes, and payoff. | Demoable dispatch history and visible event grounding. |

## Cadence And Triggers

Default:

- Run every **10 minutes**.
- Configurable: 5, 10, 20, or manual-only.
- Use one smarter model profile per run.

MVP:

- Scheduled only.
- Manual CLI trigger for demos and testing.

Post-MVP event triggers:

- Soul born.
- Resident reaches low AP.
- Resident fades/dies.
- Resident completes goal and becomes saved.
- NCRI minted, sold, or redeemed.
- Quest started or completed.
- Major patron gift.
- Notable multi-resident interaction.
- System-wide warning: many stuck residents, inference outage, or no meaningful progress.

Trigger guardrails:

- Cooldown per trigger type.
- Batch multiple events into one dispatch.
- Never post more often than a configured public minimum interval unless operator explicitly forces it.

## Inputs

The Storyteller should read a compact digest, not raw unbounded logs.

Primary inputs:

- Resident Library timelines.
- Recent action summaries.
- Resident state snapshots: alive/faded/saved, position, goal, AP balance, carried GP where visible.
- Quest progress and completion events.
- AP ledger events.
- GP evidence from RuneScape coin items, trades, and inventories.
- AP-for-GP exchange events.
- Soul proposal and birth events.
- NCRI registry events.
- Patron gifts, asks, witnesses, letters.
- Recent resident speech.
- Stuck/recovery summaries.
- Model/endpoint health and timeout summaries.

Useful derived signals:

- "Most progressed resident this window."
- "Most endangered resident."
- "Most useful GP earner this window."
- "Most important AP-for-GP exchange."
- "Residents with repeated stuck loops."
- "Residents who made no meaningful progress."
- "Humans whose AP changed the outcome."
- "New canon-worthy Library moments."
- "Quest/NCRI/AP/GP events since last dispatch."

## Data Contracts

### CityEventDigest

The digest is the evidence packet sent to the model.

Suggested fields:

- `digestId`
- `createdAt`
- `windowStart`
- `windowEnd`
- `residents`
  - `id`
  - `displayName`
  - `status`: alive, faded, dead, saved, unknown
  - `goal`
  - `apBalance`
  - `gpCarried`
  - `position`
  - `faction`
  - `modelProfile`
  - `sparkModule`
  - `notableEvents`
  - `recentSpeech`
  - `progressSignals`
  - `warnings`
- `apEvents`
- `gpEvents`
- `apForGpExchanges`
- `soulEvents`
- `questEvents`
- `ncriEvents`
- `patronEvents`
- `systemEvents`
- `candidateCanonMoments`
- `redactionMap`
- `sourceRefs`

### StorytellerDispatch

The dispatch is stored after generation.

Suggested fields:

- `dispatchId`
- `createdAt`
- `digestId`
- `modelProfile`
- `mode`: scheduled, manual, triggered
- `publicTitle`
- `publicBody`
- `publicBullets`
- `operatorSummary`
- `operatorWarnings`
- `libraryMomentSuggestions`
- `residentMentions`
- `eventRefsUsed`
- `redacted`
- `safetyFlags`
- `tokenUsage`
- `costEstimate`
- `published`: true/false

## Architecture

### Components

| Component | Responsibility |
|---|---|
| `CityEventDigestBuilder` | Reads logs/state and builds a bounded, structured evidence digest. |
| `StorytellerPromptBuilder` | Converts the digest into a strict model prompt with voice and grounding rules. |
| `StorytellerModelClient` | Calls the configured smarter model profile. |
| `StorytellerVerifier` | Checks the model output references known events and does not include forbidden claims. |
| `StorytellerStore` | Persists dispatch JSON and any public text snapshot. |
| `StorytellerScheduler` | Runs on interval and handles trigger cooldowns. |
| `StorytellerCLI` | Manual run, dry run, inspect latest, republish latest. |
| `StorytellerSurfaceAdapter` | Exposes latest dispatch to dashboard, Embassy, wall, and Library chronicle. |

### Flow

1. Scheduler or CLI requests a run.
2. Digest builder reads recent city state.
3. If nothing happened, it either skips or produces a quiet "city is breathing" dispatch depending on config.
4. Prompt builder creates a grounded JSON-output prompt.
5. Model client calls smarter profile.
6. Verifier checks:
   - valid JSON;
   - event refs exist;
   - no forbidden sensitive handles;
   - no unsupported deaths, quest completions, NCRIs, AP grants, GP trades, or births.
7. Store writes dispatch.
8. Public surfaces read latest dispatch.
9. Operator surfaces show evidence and warnings.

## Prompt Contract

The model should output structured JSON first, not free text.

Required sections:

- `publicTitle`: short, dramatic.
- `publicBody`: 1-3 short paragraphs.
- `publicBullets`: 0-4 concrete happenings.
- `operatorSummary`: plain-language status.
- `operatorWarnings`: array of possible problems.
- `libraryMomentSuggestions`: optional array.
- `eventRefsUsed`: array of digest event ids.

Hard rules:

- Do not claim a death unless a death/fade event exists.
- Do not claim a quest completed unless a completion event exists.
- Do not claim an NCRI exists unless it is in the digest.
- Do not claim AP was granted unless an AP ledger event exists.
- Do not claim GP moved unless RuneScape coin/trade evidence exists.
- Do not confuse AP with GP: AP sustains residents; GP is RuneScape gold for humans/printers.
- Do not reveal raw private handles in public fields.
- Do not invent humans, items, residents, locations, or goals.
- If the evidence is weak, say the city is quiet.
- Public text should be vivid; operator text should be literal.

## Model Strategy

Use a smarter model because the Storyteller is low-frequency and high-leverage.

Default target:

- Use paid/smarter profile for Storyteller.
- One call per 10 minutes is cheap compared with resident body loops.
- Log token/cost usage per dispatch.

Candidates to evaluate:

- Haiku via OpenRouter for cost-effective narration.
- Sonnet for best quality if adapter and budget allow.
- MiniMax if we build an adapter that produces reliable structured output.
- Qwopus local as a free/fast fallback if paid endpoint fails.

Fallback behavior:

- If smarter model fails, use local model.
- If all model calls fail, publish no new public dispatch and write an operator warning.
- Do not generate fake dispatches from templates unless explicitly in demo fallback mode.

## Public Surfaces

MVP surfaces:

- Latest dispatch JSON endpoint.
- CLI: `storyteller:run`, `storyteller:latest`, `storyteller:dry-run`.
- Wall/Embassy card once UI work resumes.

Later:

- Dashboard panel with latest dispatch + evidence refs.
- Library "Chronicle" page with dispatch history.
- Audio narration / venue speaker output.
- Event-triggered wall flash for saved residents or NCRI redemption.

## Safety And Grounding

Public canon is powerful. The Storyteller must be vivid without lying.

Required safeguards:

- Redact private human handles on public surfaces.
- Attach event refs to every factual dispatch.
- Persist the digest used for each dispatch or a hash/reference to it.
- Run verifier before publishing.
- Mark low-confidence dispatches.
- Operator can unpublish a dispatch.
- Dispatches should be append-only; corrections are new records, not silent rewrites.

Human-facing correction policy:

- If the Storyteller gets something wrong, publish a correction in the next dispatch.
- Do not silently edit public canon after people may have seen it unless it contains sensitive info.

## MVP Task List

### P0: Design Contracts

- Define `CityEventDigest` TypeScript type.
- Define `StorytellerDispatch` TypeScript type.
- Define `StorytellerConfig`.
- Define economy vocabulary:
  - AP means Attention Points, the resident life-force ledger.
  - GP means real RuneScape gold coins, not a second Null City ledger.
  - AP-for-GP exchange means a human grants AP and receives GP/items through RuneScape trade.
- Decide first file paths:
  - `data/controller/storyteller/digests/*.json`
  - `data/controller/storyteller/dispatches/*.json`
  - `data/controller/storyteller/latest.json`
- Add config defaults:
  - enabled false by default until tested;
  - cadence 10 minutes;
  - max digest window 10 minutes;
  - max resident mentions 8;
  - max public body 180 words.

### P0: Digest Builder

- Read resident Library timelines for the last window.
- Read resident runtime state snapshots.
- Read AP ledger events when available.
- Read RuneScape GP evidence when available.
- Read AP-for-GP exchange events when available.
- Read NCRI events when available.
- Read quest events from timeline/perception artifacts.
- Summarize action counts and warnings.
- Limit and sort events by importance.
- Produce deterministic digest fixtures for tests.

### P0: Prompt + Model

- Build prompt from digest.
- Require JSON output.
- Include voice rules and forbidden claims.
- Use configured model profile.
- Record token/cost metadata.
- Add dry-run mode that writes digest but skips model call.

### P0: Verifier

- Validate JSON shape.
- Ensure every `eventRefsUsed` value exists in the digest.
- Scan public fields for raw private handles.
- Block unsupported death/quest/NCRI/birth claims.
- Mark dispatch as `needs_review` if verifier is uncertain.

### P0: Store + CLI

- Store digest and dispatch JSON files.
- Maintain `latest.json`.
- Add CLI:
  - `npm run storyteller:run`
  - `npm run storyteller:dry-run`
  - `npm run storyteller:latest`
- CLI prints public title/body plus operator warnings.

### P0: Fixture Benchmark

- Create fixed digest fixture with:
  - one low-AP resident;
  - one AP-for-GP exchange;
  - one GP-earning event;
  - one quest progress event;
  - one stuck/recovered event;
  - one patron gift;
  - one quiet resident.
- Run Storyteller against the fixture.
- Score:
  - valid JSON;
  - includes required facts;
  - does not invent forbidden facts;
  - public text is concise and vivid;
  - operator summary is useful.

## P1 Task List

### Scheduler

- Add scheduler loop with configurable cadence.
- Add manual disable/enable.
- Write run status:
  - last run time;
  - last success;
  - last failure;
  - next scheduled run;
  - model profile;
  - token/cost totals.

### Public Endpoint

- Add `GET /v1/storyteller/latest`.
- Add `GET /v1/storyteller/dispatches?limit=N`.
- Public response must only include redacted public fields.
- Operator response can include evidence refs and warnings when authenticated.

### Event Triggers

- Trigger on `soul_born`.
- Trigger on `resident_saved`.
- Trigger on `resident_faded`.
- Trigger on `ap_low`.
- Trigger on `ap_for_gp_trade`.
- Trigger on `gp_earned`.
- Trigger on `ncri_sold`.
- Trigger on `ncri_redeemed`.
- Trigger on major quest completion.
- Trigger on severe system warning.
- Add cooldown and batching.

### Surface Integration

- Wall ticker card.
- Embassy landing card.
- Dashboard operator panel.
- Library Chronicle page.

Guardrail: do not build new UI before Dev's MDA framework lands; keep API/store/CLI work first.

## P2 Task List

- Audio narration for the venue.
- Faction-colored Storyteller modes.
- Human "ask the Storyteller what happened" prompt.
- Printer queue / GP spend narration.
- Storyteller-generated weekly chronicle.
- Storyteller quality evaluation across models.
- Admin review queue for dispatches before public publishing if public-canon risk becomes too high.
- Let saved residents receive special Storyteller epilogues.

## QA Plan

Unit tests:

- digest builder includes only bounded window events;
- digest builder sorts important events first;
- digest builder separates AP ledger events from RuneScape GP evidence;
- prompt builder includes grounding rules;
- verifier rejects unknown event refs;
- verifier redacts private handles;
- store writes latest dispatch atomically.

Integration tests:

- dry-run creates digest without model call;
- fixture run creates valid dispatch;
- AP-for-GP fixture produces accurate AP and GP language;
- no-event window produces skip or quiet dispatch based on config;
- model failure records operator warning without publishing fabricated text.

Live tests:

- Run against a 10-minute controller log window.
- Compare dispatch claims to source events.
- Human score for:
  - specificity;
  - drama;
  - factual accuracy;
  - usefulness;
  - brevity.

Benchmarks:

- Run same fixture through Haiku, Sonnet, MiniMax, Qwopus.
- Score hallucination rate, JSON validity, latency, cost, and human preference.
- Choose default model profile for Storyteller after at least 10 fixture runs.
- Include at least one economy fixture that has AP grants, GP movement, and NCRI redemption.

## Acceptance Criteria

MVP is ready when:

- A human can run one command and get a grounded Storyteller dispatch.
- The dispatch references only real digest events.
- The dispatch correctly distinguishes AP from GP.
- Private handles are redacted in public text.
- Operator notes explain what evidence drove the dispatch.
- Output is stored and retrievable as latest.
- A fixture benchmark passes consistently.
- The generated public copy feels like Null City, not a generic status report.

## Open Questions For Tonight

1. What is the official public name: Storyteller, City Crier, Dungeon Clerk, The Voice, or something else?
2. Is the public voice more funny/cruel, mythic/archival, or civic/bureaucratic?
3. Should every dispatch be immediately public canon, or should first deploy be operator-reviewed?
4. What is the first surface: wall ticker, Embassy, dashboard, or all via JSON first?
5. Should Storyteller mention model/system failures publicly, or keep those operator-only?
6. Should Storyteller mention printer/GP economics explicitly or keep printer logistics operator-only?
7. Can Storyteller suggest quests or only narrate existing events?
8. Can Storyteller write permanent Library moments automatically?
9. How much profanity/snark is acceptable at the OnionDAO event?
10. Should Storyteller read humans as "patrons", "citizens", "visitors", or something faction-specific?
11. Should saved residents get a special Storyteller epilogue immediately on completion?
