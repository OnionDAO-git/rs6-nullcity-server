# OnionDAO CIC Meetup Decisions - 2026-05-29

Source: `/Users/james/Downloads/OnionDAO CIC Meetup.txt`

This captures the actionable product/process decisions from the CIC meetup transcript. Use it to refine the weekend sprint; it is not a replacement for the active task board.

## Weekend MVP Direction

Dev's repeated priority: get the simple Null City loop working and polished by Sunday. Stretch ideas are welcome after that loop works.

The simple loop is:

1. Humans earn Attention Points (AP).
2. Humans use AP to support residents.
3. Residents need AP to live.
4. Residents earn real RuneScape GP.
5. Humans use AP to buy GP or special RuneScape-item value from residents.
6. Humans spend GP on special printable RuneScape items.
7. Residents use survival, GP, and Library knowledge to pursue their Soul goals.

## AP / GP Currency Decision

- Use two public currencies: **Attention Points (AP)** and **GP**.
- AP replaces the Shards/onion-points wording for the resident-support loop.
- GP is real RuneScape gold, not a second Null City ledger.
- Regular printing can use AP or existing OnionDAO points if the dashboard/product needs it.
- Special RuneScape-themed printable items should require GP so humans have a reason to interact with residents.
- Humans do not need their own RuneScape gold account. They acquire GP value from residents through the Null City loop.

## Goal And Intelligence Direction

- Do not build a broad RuneScape quest system by Monday.
- Focus resident action surface on **skilling, combat/survival, and wealth/GP**.
- A Soul goal can be aspirational and may never complete. That is acceptable.
- The minimum intelligence requirement is not "finish every goal"; it is "generate a plausible plan toward the goal, act on survival/GP needs, and learn from the Library of Souls."
- Residents should use a hierarchy of needs:
  1. Survive and maintain enough AP.
  2. Earn or preserve GP so they can trade for AP/human support.
  3. Pursue the Soul's larger goal.
  4. Write useful discoveries back into the Library.
- A strong first-generation goal is practical: "find a reliable way to make 100 GP/hour and write the strategy into the Library."

## Scope Cuts For This Weekend

- Do not implement all RuneScape quests.
- Do not make factions/buildings/action territories part of the weekend MVP.
- Do not add human bounty hunting against residents.
- Resident-versus-resident PvP may be explored later, but humans should not be incentivized to kill residents.
- Capture-the-flag and faction sabotage are stretch ideas after the simple loop works.

## Repo And UI Boundaries

- Only two repos matter for this work:
  - `rs6-nullcity-server`: server, controller, residents, JSON/control APIs, logs, benchmarks.
  - `rs6-nullcity-residents-dashboard`: dashboard, user-facing UI, forked client bundle, print queue UI.
- No human-facing UI belongs in the server repo.
- The city dashboard should stay separate from the main OnionDAO site, with a banner/button from the main site into Null City.
- The dashboard/client login path may require local Docker Compose parity with the Railway deployment. Dev's note: use the Railway deploy scripts as the source for local service composition.

## Physical/Event Notes

These are mostly outside the server repo, but useful context:

- RC blimps/balloons are a Sunday activation priority for the physical team.
- GPIO module detection for badge hardware is a low-priority tracked task.
- ButterflyMX access needs to be granted to the team.
- Badge STL/clip printing and print-queue bridge remain physical/dashboard-side work.

## Implications For Autonomous Agents

- Prioritize AP/GP survival and GP earning over quest expansion.
- Use CQA quest work only to prove bounded capability or expose missing game primitives; do not let it dominate the weekend.
- Add resident behavior that links Soul goals to practical plans through AP, GP, and Library strategy lookup.
- Treat "Library as accumulated strategy" as core: residents should read prior attempts and write back useful findings.
- Keep dashboard/client/UI tasks in the dashboard repo.
