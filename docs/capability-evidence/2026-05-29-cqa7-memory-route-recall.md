# CQA7 - Memory Route/Fact Recall (2026-05-29)

Packet: `CQA7`  
Lane: `F`  
Date: 2026-05-29

## Scope

Validate whether resident memory recall is only synthetic benchmark output or also visible in ordinary controller life, then separate **fact recall** from **route recall** confidence.

## Evidence Sources

- `data/agent-logs/res:bmk_memory_*/2026-05-*.jsonl`
- `data/controller/logs/res:*/actions/*.jsonl`

## What Was Checked

1. Enumerated all `res:bmk_memory_*` benchmark-run logs present locally.
2. For each run, checked for:
   - Prompt receipt (`"what do you remember about alice@onion and my shrimp promise?"`).
   - Recall response containing the taught fact/promise.
   - Malformed memory dump style output (raw structured blob leakage).
3. Counted ordinary (non-benchmark) controller actions with `cause:"nervous:patron-memory-acknowledge"` and resident coverage.

## Results

- Memory benchmark runs found: **10**
- Runs with clear taught-fact recall response: **9/10**
- Runs with malformed structured-dump response: **1/10** (`res:bmk_memory_01x6ig8r`)
- Prompt was present in all 10 runs.

Ordinary controller-life memory evidence:

- `nervous:patron-memory-acknowledge` actions: **29**
- Residents showing this behavior: **3** (`res:agent`, `res:hans`, `res:pip`)

## Interpretation

- **Fact recall** is now strongly evidenced in both benchmark and ordinary logs.
- **Route recall after delay** is still not proven by this packet's evidence set. Current memory benchmarks center on taught social/fact recall, not delayed navigation reuse.
- One malformed response indicates formatting reliability still needs guardrails when recall triggers.

## Capability Impact

- Upgrade "Remember and recall supplied facts" confidence and evidence details.
- Keep "memory route recall" as a remaining gap with an explicit follow-up issue.

## Follow-up

- Add a delayed route-memory benchmark (teach route/fact, force wait window, require route execution) and capture artifact/log proof.
