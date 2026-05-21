# Human Decision Log

Track choices that James or OnionDAO need to make. Do not keep them only in chat.

## Decision Rules

- **Critical** means the current task cannot continue without an answer, or continuing risks secrets, data loss, irreversible public API churn, or broken launch commitments.
- **Open** means useful to decide later, but agents should keep building with the listed default assumption.
- **Decided** means use the recorded answer until James or OnionDAO changes it.
- If a decision becomes critical, mark the related roadmap task `[!]` and write the exact blocker there.
- Until **June 1, 2026**, OnionDAO work is pre-launch development. Prefer fast local progress with good design over Railgun hardening or secure third-party module infrastructure unless those concerns directly block the task.

## Current Decisions

| ID | Status | Priority | Decision Needed | Default Assumption Until Answered |
| --- | --- | --- | --- | --- |
| HD-001 | Decided | Normal | How should agents balance speed vs Railgun/security work before OnionDAO starts? | Before June 1, 2026, optimize for fast local development and good design. Track Railgun/security questions, but do not let them block gameplay, dashboard, benchmark, or SPARK module progress unless they become critical. |
| HD-002 | Open | Normal | What exact Railgun topology will OnionDAO use? Gateway URL/path, dashboard URL, secret names, persistent volume paths, and artifact/log sink are still unknown. | Keep Railgun docs as templates. Do not block local controller/dashboard work on this. |
| HD-003 | Open | Normal | Are OnionDAO member-authored modules allowed now if PR-reviewed in-repo, or blocked until the public safe module contract is fully wired? | Treat reviewed in-repo modules as allowed for dev experiments. Do not load arbitrary code from SOUL, memory, packages, or remote URLs. |
| HD-004 | Open | Normal | Should SPARK module distribution stay bundled in the controller build, or eventually use pinned artifact/digest modules? | Keep modules bundled in the controller build. Design APIs so pinned artifacts could be added later. |
| HD-005 | Open | Normal | When do multi-controller Railgun deployments need `external-store` instead of per-instance JSONL suggestion files? | Use local JSONL/persistent-volume suggestion files for dev and single-controller runs. Revisit before multi-controller Railgun deployment. |
| HD-006 | Open | Normal | Which model/provider profile should be the default for long-running agent experiments? | Use the current configured local/nullcity inference endpoint unless the task explicitly needs another model. |

## How To Add A Decision

Append a row with:

- a stable `HD-###` id
- status: `Open`, `Critical`, or `Decided`
- priority: `Critical`, `High`, `Normal`, or `Low`
- a concrete question
- the default assumption agents should use meanwhile

Keep this file short. Move long rationale into specs or task docs and link it from the row when needed.
