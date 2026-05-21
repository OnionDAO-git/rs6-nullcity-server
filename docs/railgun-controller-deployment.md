# Railgun Controller Deployment

This is the minimum deployment checklist for running the resident controller outside a laptop.

Railgun deployment is not a blocker for pre-launch development before June 1, 2026. Keep this guide useful, but prioritize local agent gameplay, dashboard debugging, benchmarks, and clean module design until OnionDAO chooses a concrete deployment topology.

## Required Secrets And Paths

Set these explicitly in Railgun or the container job:

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

`/data/...` should be a durable volume or a backed artifact sink. Do not rely on the app checkout for runtime memory, logs, or suggestions.

## Controller Config Shape

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
      model: REPLACE_ME_MODEL_NAME
```

Tokenless gateway access is loopback-local only. A remote Railgun gateway must use `gateway.authToken`.

## Start And Observe

```bash
npm run build
node dist/controller/index.js --config "$CONTROLLER_CONFIG"
```

Use the dashboard against the same memory/log/soul roots to observe `res:agent`. If there are multiple controller instances, include `CONTROLLER_INSTANCE_ID` in logs and suggestion files so artifacts can be traced.

## Open Human Choices

- Exact gateway URL/path and dashboard URL.
- Secret names and rotation process.
- Persistent volume versus external-store for suggestions and benchmark artifacts.
- Whether future modules remain bundled in the controller build or move to pinned artifact/digest distribution.
