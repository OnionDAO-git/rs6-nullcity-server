# CQA3: Normal gear soak evidence audit (2026-05-29)

Packet: `CQA3`  
Issue: `QA-20260529-005`  
Owner: `codex`

## Scope

Goal was to prove or disprove ordinary (non-benchmark-harness) equip behavior for named residents.

## Evidence Collected

1. Ordinary controller action logs currently show no equip actions:

```bash
rg -n '"kind":"equip"' data/controller/logs/res:*/actions/*.jsonl -S | wc -l
# 0
```

2. The same named-resident logs are active and non-empty (combat/movement/speech still happening):

```bash
rg -n '"kind":"(attack|eat|interact|move_to|say|use_item_on|use_item_on_item)"' \
  data/controller/logs/res:(qa-guardian|qa-survivor|qa-trader|qa-priest|hans|thrand|pip|duke-horacio)/actions/*.jsonl -S \
  | awk -F'"kind":"' '{print $2}' | awk -F'"' '{print $1}' | sort | uniq -c | sort -nr

# 93684 move_to
# 69045 say
# 2889 interact
#   152 attack
#     6 eat
#     1 use_item_on_item
```

3. Equip actions do appear in benchmark-resident logs, confirming the adapter path works:

```bash
rg -n '"kind":"equip"' data/agent-logs data/controller/logs -S | perl -ne \
  'if(m#data/agent-logs/([^/]+)/#){print "$1\n"} elsif(m#data/controller/logs/([^/]+)/#){print "$1\n"}' \
  | sort | uniq -c | sort -nr

# 1 res:bmk_equipme_01lpkehu
# 1 res:bmk_equipme_018tdznp
# 1 res:bmk_equipme_015nmz1d
# 1 res:bmk_equipme_00z8erdo
# 1 res:bmk_equipme_00yhrjwg
```

4. QA soul setup explains why ordinary proof is thin:
- `res:qa-survivor` starts with equipment already equipped (`initialEquipment` present), so no equip step is needed.
- `res:qa-priest` has no `initialEquipment` and no training weapon/armor inventory entry.
- `res:qa-guardian` starts with food inventory and shield/sword already in `initialEquipment`.

Sources:
- `src/controller/soul/starter-souls/res-qa-guardian.md`
- `src/controller/soul/starter-souls/res-qa-survivor.md`
- `src/controller/soul/starter-souls/res-qa-priest.md`

## Conclusion

`CQA3` disproves the ordinary-life claim for now: equip/wield behavior is benchmark-proven but still unproven in named resident loops.

Root cause is primarily scenario/setup, not current engine action mapping:
- Existing named QA souls either start pre-equipped or are not seeded with unequipped training gear.
- Ordinary loops therefore rarely create an equip decision opportunity.

## Next Action

Keep `QA-20260529-005` open and run a follow-up soak where at least two named residents start with combat gear in inventory (not equipped), then collect ordinary `res:*` action-log proof of `kind:"equip"` before combat.
