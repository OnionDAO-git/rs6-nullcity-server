# Controller Knowledge Feedback Runbook

This runbook explains how OnionDAO should run the resident controller with game-skill feedback enabled, collect suggestions, and promote safe RuneScape knowledge updates.

## Runtime Configuration

Local development can use repo-relative defaults. Railgun/container deployments should use explicit durable directories:

```bash
CONTROLLER_CONFIG=/app/controller.yml
CONTROLLER_INSTANCE_ID=${RAILGUN_INSTANCE_ID}
CONTROLLER_MEMORY_DIR=/data/controller/memory
CONTROLLER_LOG_DIR=/data/controller/logs
CONTROLLER_KNOWLEDGE_DIR=/data/controller/knowledge
CONTROLLER_SOULS_DIR=/app/data/souls
GATEWAY_AUTH_TOKEN=REPLACE_ME_GATEWAY_TOKEN
RUNEBENCH_WIKI_DIR=/app/reference/RuneBench/wiki
NODE_ENV=production
```

Use this controller config shape:

```yaml
controller:
  instanceId: ${CONTROLLER_INSTANCE_ID}
residents:
  - res:agent
gateway:
  url: wss://REPLACE_ME_AGENT_GATEWAY_HOST/agent
  controllerId: onion-controller
  authToken: ${GATEWAY_AUTH_TOKEN}
souls:
  dir: ${CONTROLLER_SOULS_DIR}
memory:
  dir: ${CONTROLLER_MEMORY_DIR}
logging:
  dir: ${CONTROLLER_LOG_DIR}
knowledge:
  dir: ${CONTROLLER_KNOWLEDGE_DIR}
  runebenchWikiDir: ${RUNEBENCH_WIKI_DIR}
  enableSuggestions: true
  emitStdout: true
  storageMode: persistent-volume
llm:
  endpoints:
    default:
      baseUrl: http://inf.nullcity.ai:1234
```

In production, startup fails if it sees laptop-style local defaults for memory/log/knowledge directories. That is intentional: Railgun feedback should land in `/data/...` or in stdout logs, not inside an ephemeral app checkout.

Tokenless gateway access is for loopback local development only. Any Railgun, private-network, or public `wss://` gateway must set `gateway.authToken` from a secret.

## Wiki Reference Paths

| Environment | `RUNEBENCH_WIKI_DIR` | Notes |
| --- | --- | --- |
| Local dev | optional repo-local reference checkout | Leave unset if no wiki snapshot is available. |
| Railgun | `/app/reference/RuneBench/wiki` or another mounted read-only path | Mount the snapshot with the controller image or job config. |

Engine-local facts and observed benchmark evidence take priority over imported wiki text. Use wiki snippets as supplemental hints, not as authority over item ids, object ids, action verbs, or engine-visible success signals.

## Where Feedback Goes

Every suggestion is emitted to stdout as a single JSON object:

```json
{"event":"knowledge_suggestion","id":"ks_attempt-...","resident":"res:agent","workflowId":"make-fire"}
```

When `storageMode: persistent-volume`, the controller also mirrors each event to:

```text
${CONTROLLER_KNOWLEDGE_DIR}/suggestions.<controllerId>.<instanceId>.jsonl
```

If file writes fail, the controller emits a `knowledge_suggestion_write_failed` stdout event and keeps the resident running.

## Review Suggestions

From a local checkout or CI worker:

```bash
npm run controller:knowledge:review -- /data/controller/knowledge
```

For stdout-drained Railgun logs, first export only suggestion events into JSONL files:

```bash
mkdir -p /tmp/controller-knowledge
grep '"event":"knowledge_suggestion"' railgun-controller.log > /tmp/controller-knowledge/suggestions.railgun-export.jsonl
npm run controller:knowledge:review -- /tmp/controller-knowledge
```

The review output groups suggestions by `dedupKey`, shows first/last seen times, residents, statuses, and example evidence bundles. Treat these as review artifacts, not source-of-truth facts.

## Promotion Rules

Promote a suggestion only when all relevant checks pass:

- The evidence includes an action attempt id and perception id.
- The observation is backed by engine-visible state, such as inventory, HP, nearby object/item, chat, or skill XP changes.
- It does not conflict with engine-local item/object/NPC facts.
- It is compact enough for weak models and names exact actions, item slots, targets, or options where possible.
- It does not weaken combat or survival safety.
- Focused controller knowledge and thinking tests pass.

After editing curated knowledge or workflow code, run:

```bash
npm test -- --runInBand src/controller/knowledge src/controller/thinking
npm run typecheck
npm run lint
npm run build
```

Do not commit runtime `suggestions.*.jsonl` files. Commit only curated source, tests, docs, and benchmark artifacts.

## Rejection Rules

Reject suggestions that are hallucinated, duplicated, too local to one accidental position, or unsupported by engine evidence. Keep rejected groups as review artifacts so future tooling can suppress repeated noise.

## Automation Options

- Railgun scheduled job: export stdout `knowledge_suggestion` events to a durable artifact bucket, then run the review command.
- Dashboard panel: read `suggestions.*.jsonl`, group by `dedupKey`, and expose accept/reject notes.
- CI benchmark job: run starter workflows and compare pass rate, invalid action count, unsafe action count, and median action count.
- Codex heartbeat: summarize new groups, draft source patches, and leave them for human review.
