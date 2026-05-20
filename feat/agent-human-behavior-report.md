# Agent Human Behavior Report

## Goal

Make `res:agent` feel less like a command macro and more like a basic old RuneScape player: visible, purposeful, opportunistic, interruptible, and able to explain what it is trying to do.

## Human Player Baseline

A human player does not simply execute one low-level action forever. Even a new player usually:

- Keeps a loose goal stack: get logs, make a fire, train a skill, survive, return to a familiar area.
- Notices nearby opportunities while moving: coins, bones, logs, NPCs, doors, gates, safe enemies, or other players.
- Chains actions into workflows: walk to tree, chop tree, notice logs, use tinderbox, move away from blocked tiles, repeat.
- Checks whether the last action worked and changes strategy when it did not.
- Gives visible social feedback: answers questions, says what they are doing, and asks for help when blocked.
- Avoids obvious danger: eats, retreats, or stops fighting when health is low.
- Uses local geography: opens gates, walks around fences, returns to landmarks, and keeps itself findable.

## Current Agent Behavior

The current agent has a useful brain/body/nervous-system shape, and it can now perform simple routines such as woodcutting into firemaking. It still feels awkward compared with a human because:

- Initiative is thin. It follows active routines but rarely takes useful side actions without being prompted.
- Exploration is mostly observational. It may say it sees an item instead of deciding to pick up an obviously useful one.
- Workflow memory is shallow. It can do individual steps, but it does not yet keep a strong "next useful subtask" queue.
- Navigation is brittle. When a target is unreachable, it needs clearer recovery choices: different target, different route, door/gate, or return to known open ground.
- Visibility is still uneven. The dashboard exposes actions, but the agent should also regularly reveal intent, blockers, and recovery plans in-game.
- Social behavior is reactive. It responds to commands, but it does not yet volunteer enough useful suggestions or ask for specific help.
- Combat and trading are basic. The hooks exist, but the agent needs safer loops around food, target selection, loot, and trade state.

## Prioritized Fix List

1. Opportunistic pickups during scouting and travel.
   Humans pick up useful nearby items while exploring. The agent should notice safe, useful ground items such as coins, logs, bones, and food, move to them, pick them up, then resume its active goal.

2. Workflow chains for core skills.
   Firemaking, woodcutting, prayer, and combat should be represented as small task chains with checks after each step, not only one action chosen at a time.

3. Stronger goal stack and task memory.
   The Brain should produce a high-level ambition and the Body should maintain current subtask state: target, why it was chosen, recent failures, and next fallback.

4. Navigation affordances.
   The Body should recognize doors, gates, stairs, and blocked movement, then try open/use/walk-around behavior before giving up.

5. Human-like social loop.
   The agent should answer player speech, summarize its current goal, ask for help when stuck, and make small suggestions based on the local environment.

6. Combat survival and loot loop.
   The nervous system should continue to own survival. The Body should select only safe targets, stop at low health, collect loot, and train prayer on bones.

7. Trading workflow.
   The agent should request trades, offer simple items, accept safe trades, reject suspicious states, and describe what it is doing.

8. Evaluation harness.
   Add repeatable scenarios for "human-like" behavior: visible movement, useful pickup, make fire, talk to NPC, safe fight, loot bones, bury bones, and recover from blocked movement.

## First Implementation Slice

The first slice is opportunistic pickup during exploration. It is deliberately small but important: when scouting, `res:agent` should prefer safe useful ground items over passive observation. This makes the agent visibly take initiative without waiting for a full planner rewrite.

## Implemented MVP Behaviors

- Opportunistic pickup now runs during scouting, travel, and nearby routine skill work, with distance limits so the agent does not abandon its main task for far-away items.
- Recently attempted ground pickups are remembered briefly, so a persistent item on the floor does not trap the agent in an obvious repeat loop.
- Routine skill loops now recover by switching into visible scouting when the agent appears stuck on repeated woodcutting or firemaking actions.
- Woodcutting practice now explicitly pivots into a firemaking subgoal once the agent has logs and a tinderbox, instead of treating firemaking as an unrelated fallback.
- Movement commitment now avoids thrashing between distant targets, clears stale movement when the Brain changes goals, and tries to open nearby known doors or gates before giving up on a stuck path.
- Combat training now prefers safe low-level NPCs, eats or refuses combat when hurt, loots useful drops between fights, and buries carried bones outside active combat.
- Trade behavior now reciprocates trusted player requests, offers safe spare items, advances accept stages, and declines active trades with untrusted partners.
- Social beacons now include the active goal and, when possible, a concrete nearby next step such as picking up coins, talking to an NPC, chopping a tree, or opening a door.
