# Residents — Implementation Spec

Living document. Update the status checklist at the bottom as work lands.

## 1. Problem

The world only contains two kinds of actor: real `Player`s driven by a connected
RS client over the game socket, and `Npc`s driven by static scripts and the
existing aggression/combat/dialogue plugins. Neither is suitable for an
**autonomous, observable, externally-controlled player** — an "AI agent in the
world."

We want a third actor type, `Resident`, that:

1. Walks the **same code paths** as `Player` (inventory, skills, equipment,
   combat, dialogue, quests, pathing, region updates) so content authored
   against `Player` Just Works for it. No parallel implementation of those
   systems.
2. Has **no game client and no socket** — all outbound RS protocol packets are
   dropped on the floor.
3. Has a clean **brain ↔ body** boundary so the controller (LLM-with-tools, a
   scripted FSM, a behaviour tree, a human at a debugger) is never coupled to
   internal player methods like `pathfinding.walkTo(...)`.
4. Is **observable and controllable in real time from outside the process** via
   a streaming transport, so a separate "viewer" client (a fork of
   `rs6-nullcity-client-ts`) and arbitrary external agents can both see and
   drive Residents without polling.

The existing `World.generateFakePlayers()` (`world.ts:460`) hacks this by
constructing `new Player(null as any, null as any, null as any, ...)`. That
crashes the first time anything in `Player` or `OutboundPacketHandler` touches
the socket. This spec is the proper fix.

## 2. Goals

- A `Resident` actor type that behaves indistinguishably from `Player` from the
  point of view of plugins, NPC AI, the chunk manager, the action pipeline,
  and the combat system.
- A typed `Perception` snapshot built on the tick boundary describing what the
  Resident can see and do.
- A typed `AgentAction` union the brain emits; an `ActionAdapter` translates
  each action into the corresponding internal Player call(s) on the next tick.
- A WebSocket gateway exposing one stream per resident: perceptions push to the
  controller, actions push to the server.
- An MCP server façade layered on top of the same internal session so any
  LLM-with-tools controller can `observe_resident` and `submit_action` without
  speaking the WS protocol directly.
- A read-only SSE stream for passive spectators (used by the viewer client
  before it gains its own first-class WS path).
- Full **action log** persisted per resident as the audit trail.
- **Persistent resident identities.** A resident exists on disk as a save file
  the same way a real player does. Controllers `connect` to (log in) and
  `disconnect` from (log out) an existing resident; inventory, skills,
  equipment, quest progress, and position survive both controller disconnects
  and server restarts.

Out of scope for v1: MCP `Resource` subscriptions (only tools in v1),
authentication of external controllers (loopback only — gated behind a config
flag), trading between residents, multi-controller arbitration for one
resident (one controller holds `control` at a time — see §10.2).

## 3. Architecture

```
External controller (LLM, FSM, viewer)
            │
            │  WS (bidirectional)   ┌── SSE (read-only spectator)
            ▼                       ▼
┌────────────────────────────────────────────────────────────────┐
│  src/server/agent/gateway.ts                                    │
│   - HTTP+WS server, separate port from the RS gateway           │
│   - One ResidentSession per active resident                     │
│   - JSON-RPC-ish framed messages over WS                        │
└──────────────┬─────────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────────┐
│  src/server/agent/resident-session.ts                           │
│   - Owns the link between a transport and a Resident actor      │
│   - On tick (subscribed to world.tickComplete):                 │
│       1. perception = PerceptionBuilder.build(resident)         │
│       2. broadcast perception to all attached transports        │
│       3. drain action queue → ActionAdapter.apply(resident, a)  │
│   - Records every action+perception into the action log         │
└──────────────┬─────────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────────┐
│  Resident extends Player                                        │
│   - Constructed with a NullSocket + NoopOutboundPacketHandler   │
│   - Skips client-only init (welcome screen, widget opens, etc.) │
│   - Otherwise: same actor, same world quadtree, same plugins    │
└────────────────────────────────────────────────────────────────┘
```

### Why subclass `Player` instead of `Actor`

Every plugin, action hook, dialogue tree, quest, and combat strategy in this
repo is typed against `Player` (see `combat/melee-strategy.ts`,
`plugins/dialogue/*`, the `playerOptions` in `player.ts:58`). Subclassing
`Actor` would require duplicating, forking, or making polymorphic every piece
of content. Subclassing `Player` and stubbing the transport keeps the cost on
the new code, not the existing 1500+ lines.

### Why brain ↔ body separation

If a controller calls `resident.pathfinding.walkTo(pos)` directly, three things
break: (a) controllers become coupled to engine internals and break on any
refactor; (b) the action log loses semantic meaning (we only see "the path
changed", not "the agent decided to move to the bank"); (c) we cannot validate
or rate-limit controller intent before it touches game state.

`AgentAction` is the public, versioned vocabulary. `ActionAdapter` is the only
place that knows how to translate that vocabulary into Player method calls.

## 4. Files to create

```
src/engine/world/actor/resident/
    resident.ts                     # subclass of Player
    null-socket.ts                  # net.Socket-shaped sink
    noop-outbound-packet-handler.ts # subclass of OutboundPacketHandler
    perception/
        perception-builder.ts       # snapshot from world+resident state
        perception-types.ts         # exported types of the snapshot
    action/
        agent-action.ts             # discriminated union of intents
        action-adapter.ts           # apply(resident, action) → engine calls
    brain/
        brain.ts                    # Brain interface
        scripted-brain.ts           # FSM brain used in tests / smoke
        remote-brain.ts             # bridges to a ResidentSession transport

src/server/agent/
    gateway.ts                      # HTTP+WS server (separate port)
    resident-session.ts             # ties one Resident to N transports
    transports/
        ws-transport.ts             # bidirectional
        sse-transport.ts            # read-only push
        mcp-transport.ts            # tools façade (stdio or HTTP)
    protocol/
        messages.ts                 # wire schema (zod-validated)
        action-log.ts               # append-only per-resident log
    config.ts                       # AgentGatewayConfig (host, port, auth)

feat/residents.md                   # this file
```

## 5. Files to modify

- `src/engine/world/actor/player/player.ts` — make `_socket`, `_inCipher`,
  `_outCipher` accept `null`. Guard `_lastAddress` derivation
  (`player.ts:316`). Skip welcome-screen and character-design widget opens
  when the actor is a `Resident` (or, cleaner: factor the
  "client-presentation init" out of `init()` into a separate overridable
  method so `Resident.init()` can no-op it). Do NOT touch the rest of `init()` —
  inventory, equipment, skills, action pipeline must still run.
- `src/engine/net/outbound-packet-handler.ts` — `socket` becomes
  `Socket | null`; `flushQueue()` becomes a no-op when null. All queueing logic
  stays so any plugin code that reads `outgoingPackets` doesn't crash.
- `src/engine/world/world.ts` — `generateFakePlayers()` (`world.ts:460`) is
  rewritten on top of `Resident` + `ScriptedBrain` and renamed
  `spawnFakeResidents()`. The `-fakePlayers` CLI flag stays as an alias.
- `src/server/game/game-server.ts` — when `serverConfig.agentGatewayEnabled`,
  start `AgentGateway` after `activateGameWorld()`.
- `src/engine/world/actor/util.ts` — add `isResident(actor): actor is Resident`
  using a runtime brand on `Resident`, so plugins that want to distinguish
  (e.g. anti-bot detectors, leaderboards) can.
- `FEATURES.md` — add a "Residents" section under Game World.

Do not modify combat, dialogue, quest, or skill plugins. The whole point of
this design is that they shouldn't need to care.

## 6. Headless transport

### 6.1 `NullSocket`

`net.Socket` is a class with ~50 methods and many event hooks. We don't want
`as any` everywhere downstream. Define `NullSocket` as a thin object with the
shape that `Player`, `OutboundPacketHandler`, and `GameServerConnection` are
actually observed to touch — verified by grepping. Anything not in that
observed surface throws on access (Proxy with `get` trap) so we find missed
call sites quickly during development.

We need at minimum:
- `address()` returning a `{ address: '127.0.0.1' }` stub.
- `destroy()` as a no-op.
- `write(...)` returning `true` and dropping the buffer.
- Event-emitter behaviour for `'close' | 'error' | 'data' | 'end'`.

### 6.2 `NoopOutboundPacketHandler`

Subclasses `OutboundPacketHandler`. Overrides `flushQueue()` to clear the
internal queues without writing anything. All `put*` / `queue` builders stay
untouched, so callers that introspect the handler keep working and we still
pay the (tiny) cost of building packets — useful because any crash inside a
packet builder is still surfaced.

We do **not** want a global flag like "is fake player, skip packet building."
Such flags drift and the cost is negligible (a few KB/s of buffer alloc per
resident). Keep the code paths identical except at the very edge.

### 6.3 `Resident.init()`

```ts
public async init(): Promise<void> {
    // Run base actor init: registers in chunk, marks active, etc.
    // Skip the Player-specific client UI init (welcome screen, char design,
    // command list). The Resident has no UI.
    await this.initActorOnly();

    // Action pipeline + player_init hook still fire so quest/region content
    // works the same. Plugins that try to call this.outgoingPackets.* on a
    // Resident receive a no-op handler — they don't need to special-case.
    await this.actionPipeline.call('player_init', { player: this });
}
```

`initActorOnly()` is a new protected method on `Player` extracted out of the
existing `init()` body. It contains the chunk registration, inventory load,
equipment load, bonus recalc, action pipeline registration, and the `_loginDate`
/ `_lastAddress` assignment. The current `init()` keeps its current behaviour
by calling `initActorOnly()` then doing the client-only widgets.

## 7. Perception model

A `Perception` is the **only** thing the brain sees. It's a JSON-serialisable
snapshot built on the tick boundary, after `Player.update()` runs and before
the brain produces its next action.

```ts
export interface Perception {
    readonly tick: number;
    readonly resident: {
        readonly id: string;
        readonly position: { x: number; y: number; level: number };
        readonly hp: { current: number; max: number };
        readonly skills: Record<SkillName, { level: number; xp: number }>;
        readonly inCombat: boolean;
        readonly combatTarget: ActorRef | null;
        readonly busy: boolean;
        readonly inventory: ReadonlyArray<ItemRef | null>;  // 28 slots
        readonly equipment: ReadonlyArray<ItemRef | null>;  // 14 slots
    };
    readonly nearby: {
        readonly players: ReadonlyArray<ActorRef>;       // distance ≤ visionRange
        readonly npcs: ReadonlyArray<ActorRef>;
        readonly worldItems: ReadonlyArray<WorldItemRef>;
        readonly objects: ReadonlyArray<ObjectRef>;       // landscape + spawned
    };
    readonly events: ReadonlyArray<PerceptionEvent>;   // since last perception
    readonly availableActions: ReadonlyArray<AgentActionShape>;  // see §8.3
}

type ActorRef = { id: string; kind: 'player' | 'npc' | 'resident'; key?: string;
                  name?: string; position: Pos; hpFraction: number };
type ItemRef  = { itemId: number; key?: string; amount: number; noted?: boolean };
type WorldItemRef = ItemRef & { position: Pos; ownerId?: string };
type ObjectRef = { objectId: number; position: Pos; orientation: number };

type PerceptionEvent =
    | { kind: 'hit_taken';   from: ActorRef; damage: number; type: DamageType }
    | { kind: 'hit_dealt';   to: ActorRef;   damage: number; type: DamageType }
    | { kind: 'chat';        from: ActorRef; text: string }
    | { kind: 'item_received'; item: ItemRef }
    | { kind: 'item_lost';     item: ItemRef }
    | { kind: 'died';        attacker: ActorRef | null }
    | { kind: 'arrived'; }   // walking queue drained
    | { kind: 'level_up';    skill: SkillName; level: number };
```

`visionRange` defaults to 15 tiles (same as the player update radius). The
nearby lists are built by reusing `activeWorld.findNearbyPlayers` /
`findNearbyNpcs` and filtering by instance, then projected into refs.

`events` are accumulated by `Resident` on a per-tick buffer. We add the
necessary hooks by subscribing to existing `Subject`s and `EventEmitter`s
where available (e.g. `this.playerEvents` already emits `'exp'`; combat
already emits via `applyHit`), and add new `playerEvents.emit('chat', ...)`
calls in the chatbox plugin. Hooks land in this spec's §5; this is the most
disruptive change to existing files and should be minimised.

`PerceptionBuilder.build(resident)` is pure: same inputs → same output, no
side effects. This is what makes the action log replayable.

## 8. Action model

### 8.1 The `AgentAction` union

```ts
export type AgentAction =
    | { kind: 'move_to';    target: Pos }
    | { kind: 'face';       target: ActorRef | Pos }
    | { kind: 'interact';   target: ActorRef | ObjectRef | WorldItemRef;
                            option: string }            // e.g. 'attack', 'talk-to', 'take'
    | { kind: 'use_item_on'; itemSlot: number; target: ActorRef | ObjectRef | WorldItemRef }
    | { kind: 'attack';     target: ActorRef }          // sugar over `interact + 'attack'`
    | { kind: 'cast_spell'; spellKey: string; target?: ActorRef }
    | { kind: 'equip';      slot: number }
    | { kind: 'unequip';    equipmentSlot: EquipmentSlot }
    | { kind: 'drop';       slot: number }
    | { kind: 'eat';        slot: number }
    | { kind: 'say';        text: string }              // public chat
    | { kind: 'whisper';    to: string; text: string }  // private message
    | { kind: 'logout';     }                            // disconnects the resident
    | { kind: 'noop'        };
```

Every variant has a discriminator `kind` and is the **only** way the brain can
affect the world. Brain code that wants to do something not on this list does
not get to do it — extend the union and the adapter in lockstep.

### 8.2 `ActionAdapter`

A pure dispatcher:

```ts
export class ActionAdapter {
    apply(resident: Resident, action: AgentAction): ActionResult { ... }
}

export type ActionResult =
    | { ok: true }
    | { ok: false; reason: string };  // e.g. 'target_out_of_range', 'inventory_full'
```

Each branch translates the typed action into one or more engine calls:

- `move_to` → `resident.pathfinding.walkTo(target, opts)`
- `interact` → constructs an `InteractionEvent` and dispatches it through
  `resident.actionPipeline.call('npc_interaction' | 'object_interaction' | 'spawned_item_interaction', ...)`.
  This is the same code path the inbound packet handlers use today, so any
  plugin that hooks `npc_interaction "attack"` (for example
  `plugins/combat/attack-npc.plugin.ts`) fires unmodified.
- `attack` is shorthand for `interact` with option `'attack'`.
- `say` → `resident.playerEvents.emit('chat', text)` plus the existing public
  chat update flag (so nearby real players see it).

The adapter never blocks. If an action can't be applied this tick (e.g. target
out of range), the result records the reason; the brain decides whether to
retry. We do **not** auto-walk-to-then-do; combos like "walk to NPC and attack"
are expressed by the brain emitting `move_to` then `attack` across multiple
ticks. (This keeps the controller in charge and makes the log readable.)

### 8.3 `availableActions` advertisement

The perception includes a list of action shapes that are presently *legal*:

```ts
type AgentActionShape =
    | { kind: 'interact'; target: ActorRef; options: string[] }
    | { kind: 'use_item_on'; itemSlot: number; targets: Array<ActorRef | ObjectRef> }
    | ...
```

The set is computed by `PerceptionBuilder` from the resident's vicinity and
inventory. This is how LLM brains learn what they can do without us shipping
documentation — and how scripted brains get a cheap candidate list. The brain
is *not* required to pick from `availableActions`; an action not on the list
just gets `{ ok: false, reason }` back. Advertising is advisory.

## 9. Brain interface

```ts
export interface Brain {
    /** Called on every tick the resident is alive. */
    decide(perception: Perception): Promise<AgentAction[]>;

    /** Called once after the resident is registered. */
    onAttach?(resident: Resident): Promise<void>;

    /** Called once before the resident is destroyed. */
    onDetach?(resident: Resident): Promise<void>;
}
```

A `decide()` may return zero, one, or several actions (executed in order on the
same tick). Returning more than ~3 in one tick is suspicious and should log a
warning — the brain probably wants to spread the intent across ticks.

`decide()` is `async` so a remote brain can `await` a round-trip to the
controller. To keep the world tick on-time, the tick scheduler does **not**
block on brain decisions; instead, the resident applies the *previous* tick's
decision while the next decision is in flight. This adds one tick of latency
(~600ms) which is acceptable for the use case. If a decision doesn't arrive
before the next tick, the resident applies `noop`.

Built-in brains:

- `ScriptedBrain` — takes a callback `(p) => AgentAction[]`. Used for tests and
  the `-fakeResidents` smoke flag.
- `RemoteBrain` — wraps a `ResidentSession` transport. `decide()` pushes the
  perception out, awaits the matching action message on the in-channel.

## 10. External control protocol

### 10.1 Transport choice — why WS as the primary

We need *bidirectional, low-latency, push-based* communication with multiple
external controllers. The candidates:

| Transport | Bidirectional | Push  | Standard tooling | Notes |
|-----------|---------------|-------|------------------|-------|
| WebSocket | yes           | yes   | universal        | One TCP conn per controller, multiplex residents over it |
| SSE       | server→client only | yes   | universal        | Easy for a passive viewer; needs separate HTTP for actions |
| HTTP poll | yes           | no    | universal        | Wrong fit — adds latency and CPU |
| MCP       | yes (tools+notifications) | partial | LLM-only | Built for LLMs-with-tools; awkward for a viewer client |

WS is the primary internal protocol. SSE is the read-only spectator path
(viewer). MCP is a façade on top of the same session abstraction so any
LLM-with-tools agent (Claude, ChatGPT, local models with tool support) can
drive a resident without the controller author writing WS framing code.

### 10.2 WS message schema

All messages are JSON, validated with `zod` schemas in
`server/agent/protocol/messages.ts`. The frame envelope:

```jsonc
{ "v": 1, "id": "uuid-or-incrementing-int",
  "kind": "...",      // discriminator
  "payload": { ... } }
```

Controller → server:
- `auth`              — `{ token }`  (no-op in v1 if localhost)
- `list_residents`    — `{ filter?: 'online' | 'offline' | 'all' }` returns
                        all residents on disk plus their `online: boolean`
                        and (if online) the controlling client id
- `create_resident`   — `{ name, spawnPosition?, initialInventory?, initialEquipment? }`
                        creates a new save file and immediately connects to it.
                        Errors with `ENAME_TAKEN` if a save already exists.
- `connect_resident`  — `{ name, observe: true, control: true,
                            onDisconnect?: 'logout' | 'idle' }`
                        loads the save, registers the actor in the world,
                        starts the per-tick perception loop, and attaches this
                        client. Errors with `ENO_SUCH_RESIDENT` if no save
                        exists, `ECONTROL_HELD` if another client already
                        controls it.
- `attach`            — `{ name, observe: true, control: false }`
                        attaches as an additional observer to an
                        already-connected resident. Multiple observers OK.
- `submit_action`     — `{ name, action: AgentAction }`
- `detach`            — `{ name }` — stop observing/controlling but keep the
                        resident online (so other observers stay subscribed).
- `disconnect_resident` — `{ name }` — graceful logout: saves state, runs
                        `Resident.logout()`, frees the world slot. Save file
                        remains on disk for future `connect_resident`.
- `delete_resident`   — `{ name }` — disconnects if online, then deletes the
                        save file. Irreversible. Gated by an `allowDelete`
                        config flag (default false).

Server → controller:
- `perception`      — `{ resident_id, perception: Perception }`  (pushed each tick to attached observers)
- `action_result`   — `{ resident_id, request_id, result: ActionResult }`
- `event`           — `{ resident_id, event: PerceptionEvent }` (optional fast-path, also included in next perception)
- `error`           — `{ request_id?, code, message }`

Multiple controllers can attach to one resident as **observers**, but only one
controller at a time can hold `control`. The session tracks the controlling
client; later attach-with-control requests get `ECONTROL_HELD`.

### 10.3 SSE — read-only spectator

`GET /agent/sse/:resident_id` opens an SSE stream of `perception` events. Used
by the viewer client to "fly the camera" over a resident without holding
control. The same perception object as the WS path.

### 10.4 MCP façade

`mcp-transport.ts` exposes the same `ResidentSession` over MCP tools:

- `mcp.tool('list_residents', { filter? })` → array of resident summaries (with `online: boolean`)
- `mcp.tool('create_resident', { name, spawnPosition? })` → resident summary
- `mcp.tool('connect_resident', { name, onDisconnect? })` → first perception
- `mcp.tool('disconnect_resident', { name })` → `{ ok }` (graceful logout, save retained)
- `mcp.tool('observe_resident', { name })` → latest perception (no-op if already connected)
- `mcp.tool('submit_action', { name, action })` → action result
- `mcp.tool('wait_for_event', { name, kinds[], timeout_ms })` → next matching event

A typical LLM session: `list_residents` → `connect_resident` →
`observe_resident` → loop(`submit_action` / `wait_for_event`) →
`disconnect_resident`.

The MCP server runs over stdio by default (so it can be invoked as a child
process from any MCP-capable controller) and optionally HTTP for remote
controllers. It is a thin adapter — no game logic. v1 ships MCP behind the
same auth gate as the WS port.

### 10.5 Gateway port and config

A new section in `GameServerConfig`:

```jsonc
"agentGateway": {
    "enabled": true,
    "host": "127.0.0.1",   // localhost-only by default
    "port": 43594,
    "authToken": null      // when null, only localhost connections accepted
}
```

The gateway uses the Node built-in `http` + the `ws` library (new dep). MCP
support is optional behind a `"mcp": { "enabled": false }` sub-config and a
new `@modelcontextprotocol/sdk` dep — gated so people who don't need MCP
don't pull it.

## 11. Lifecycle and persistence

Residents are persistent identities, exactly like player accounts. A resident
on disk is **offline** (just a save file, no actor in the world, no
controller) or **online** (an actor occupying a `playerList` slot, ticking
each frame, with zero or more controllers attached).

### 11.1 First-time creation

```
create_resident (WS) ──▶ ResidentRegistry.create(name)
                          │
                          │  - rejects ENAME_TAKEN if save file already exists
                          │  - writes initial save to data/residents/<name>.json
                          │    using the same shape as PlayerSave
                          ▼
                  (falls through to connect flow)
```

### 11.2 Connect (== login)

```
connect_resident (WS) ──▶ ResidentRegistry.connect(name, controller)
                          │  - errors ENO_SUCH_RESIDENT / ECONTROL_HELD
                          ▼
                  Resident constructed with NullSocket+Noop handler
                          │  (constructor reads save via loadResidentSave())
                          ▼
                  world.registerPlayer(resident)  [reuses player slot]
                          │
                          ▼
                  resident.init()  [actor-only path; same code that
                                    rehydrates inventory/skills/quests
                                    for a real player login]
                          │
                          ▼
                  ResidentSession subscribes to world.tickComplete
                          │
                          ▼
            ┌── each tick ──┐
            │ perceive ──▶ broadcast to all attached observers          
            │ drain action queue ──▶ ActionAdapter.apply       
            │ every N ticks ──▶ autosave (cheap — just a JSON write)    
            └───────────────┘
                          │
                disconnect_resident, or transport drops, or server shutdown
                          │
                          ▼
                  (logout flow)
```

### 11.3 Disconnect (== logout)

```
disconnect_resident (WS) ──▶ ResidentSession.logout()
                              │
                              │  - savePlayerData(resident) but to
                              │    data/residents/<name>.json
                              │  - resident.logout() runs the existing
                              │    Player.logout(): clears scheduler,
                              │    removes from chunk + quadtree, calls
                              │    activeWorld.deregisterPlayer
                              │  - session disposes; controller WS gets
                              │    a `disconnected` event
                              ▼
                       Resident is now offline.
                       Save file remains. connect_resident later
                       brings the resident back at the saved position
                       with the saved inventory.
```

### 11.4 Persistence details

- **Save location**: `data/residents/<name>.json`. Schema is identical to
  `PlayerSave` (see `player-data.ts:112`) so we can reuse `savePlayerData()`
  and `loadPlayerSave()` with a `{ saveDir }` parameter added. A
  `ResidentSave extends PlayerSave` adds one field:
  ```ts
  agentMetadata: {
      onDisconnect: 'logout' | 'idle';
      lastControllerId?: string;     // for telemetry; not auth
      createdAt: number;
      ticksLived: number;            // monotonic across sessions
  }
  ```
- **Save triggers**: (a) on graceful disconnect, (b) every 1000 ticks
  (~10 min) for online residents, (c) on server shutdown (`world.shutdown()`
  already iterates `playerList` and calls `save()` — residents inherit this
  for free), (d) on `handleDeath()` so loot drops survive a crash.
- **Name namespace**: resident names are prefixed `res:` and validated against
  a regex that excludes legal RS usernames. This prevents collisions with
  real player saves in `data/saves/` and makes residents visually obvious in
  chat / logs.
- **Slot allocation**: residents occupy normal `world.playerList` slots so
  the existing update / sync / quadtree code treats them identically. A
  `World.residentSlotCap` (default 256 of `MAX_PLAYERS = 1600`) caps how
  many of the 1600 slots residents can hold; once hit, new
  `connect_resident` calls get `EWORLD_FULL` and queue up.
- **Persistence is the source of truth.** If the server crashes mid-session,
  on restart the resident is offline and the next `connect_resident` loads
  the last autosave. There is no in-memory "live but disconnected" state
  across restarts — that would require a more complex recovery story.

### 11.5 Controller-disconnect policies

When the controller's WS drops without sending `disconnect_resident`,
behaviour depends on the `onDisconnect` policy set at connect time:

- `'logout'` (default): treat the drop as a `disconnect_resident`. Save,
  remove from world, free the slot. Symmetric with player connection loss.
- `'idle'`: keep the resident online with a built-in `IdleBrain` (stand
  still, eat food if HP < 50%). After `agentGateway.idleTimeoutSec` (default
  300s) with no controller reattach, force-logout. Useful for short network
  blips, expensive-to-respawn residents, or tests.

A reconnecting controller calls `connect_resident` again. If the resident is
still online (because `onDisconnect: 'idle'`), it transparently re-attaches
with `control: true`. If it's offline, the normal login flow runs and the
resident appears at its last saved position.

## 12. Action log

Every (perception → action → result) triple is appended to a per-resident JSONL
file at `data/agent-logs/<resident_id>/<YYYY-MM-DD>.jsonl`. Rotated daily.
Format:

```jsonc
{ "t": 1740000000000, "tick": 12345,
  "perception": { ... },          // omitted on the 99% of ticks with no events, behind a flag
  "actions": [ { "action": {...}, "result": {...} } ] }
```

In v1 only the *delta* (events + actions + result) is logged by default. Full
perception is gated behind `"agentGateway.logFullPerceptions": true` to avoid
filling disk. The log is the audit trail and replay input for the future
viewer.

## 13. Edge cases

- **World tick is behind the brain**: handled by the prev-tick decision rule
  in §9. Brain that times out 3 ticks in a row → adapter applies `noop` and
  the session emits an `error` event to the controller but does not detach.
- **Controller disconnect mid-combat**: resident keeps running on the last
  brain. Default policy: `RemoteBrain` without a transport falls back to a
  trivial `IdleBrain` (stand still, eat if HP low). Configurable per
  resident at spawn time.
- **Resident dies**: existing `Player.handleDeath()` runs; the perception
  reports `died` and the resident teleports to Lumbridge with empty inv
  (matches v1 player rules). Controller decides whether to issue more actions
  or `despawn_resident`.
- **Plugin tries to open a widget for a Resident** (e.g. dialogue): the
  no-op handler swallows the packets, but the `InterfaceState` still tracks
  open widgets. Adapter exposes `dialogue_choice` / `dialogue_continue`
  actions so brains can drive trees. Dialogue trees that block on
  `await player.sendMessage(..., true)` resolve when the brain emits
  `dialogue_continue`.
- **Two residents target each other**: works without changes — combat is
  actor-vs-actor.
- **Resident name collision with a real player**: enforced at the name regex
  level — `res:` prefix is required and reserved, real players cannot pick a
  username starting with `res:`. `create_resident` also rejects names already
  present in `data/residents/`.
- **MCP tool call submitted while the resident is processing the previous
  action**: queued FIFO. We do **not** allow a controller to drop the queue
  except via `noop` (which is a no-op anyway). Bounded queue depth = 4.
- **Two controllers connect to the same resident**: second one gets
  `ECONTROL_HELD` unless it requests `control: false`, in which case it
  attaches as an observer-only. There is exactly one controller per resident
  at any moment.
- **Reconnect race** (controller A's WS drops, controller B connects before
  the idle timeout expires under `onDisconnect: 'idle'`): B succeeds and
  takes control; if A reconnects later it gets `ECONTROL_HELD`. Last
  attempted control wins, not last successful — there is no "soft hold" we
  can preempt.
- **Save corruption**: malformed `data/residents/<name>.json` makes
  `connect_resident` fail with `ESAVE_CORRUPT` and writes the bad file to
  `<name>.json.bak.<ts>`. We do not silently recreate; a corrupted save
  usually indicates a bug we want to investigate.
- **Server crash mid-session**: on restart, all residents start offline at
  their last autosave position. Up to ~10 min of activity (autosave cadence)
  can be lost. If a controller had an open WS to a now-dead session, it gets
  an `error { code: 'ESESSION_LOST' }` on reconnect and must re-issue
  `connect_resident`.
- **`delete_resident` of an online resident**: forced disconnect first
  (no save, since we're about to delete), then unlink the file.

## 14. Tests

Under `src/engine/world/actor/resident/*.test.ts` and `src/server/agent/*.test.ts`:

- `null-socket.test.ts` — every method `Player` and `OutboundPacketHandler`
  are observed to call on `Socket` does not throw and returns a sensible value.
- `resident.test.ts` — construct a Resident in a stub world, run `init()`,
  assert no client packets are emitted and the actor is registered in the
  player list and quadtree.
- `perception-builder.test.ts` — given a fixture world with one NPC, one item,
  one nearby player, the perception lists each with correct refs.
- `action-adapter.test.ts` — one case per `AgentAction.kind` asserting the
  correct internal call is made on a mock Resident.
- `gateway.test.ts` — round-trip: spawn resident, attach, receive ≥1
  perception, submit `move_to`, observe position change in the next
  perception.
- `scripted-brain.test.ts` — a goblin-killer brain kills a goblin in ≤N ticks.

## 15. Rollout

1. **Extract `Player.initActorOnly()`** + make `OutboundPacketHandler.socket`
   optional. No behaviour change for real players. Land + verify.
2. **Land `NullSocket` + `NoopOutboundPacketHandler` + `Resident`** with no
   brain wiring. Replace `generateFakePlayers()` with `spawnFakeResidents()`
   that just spawns 10 idle residents around Lumbridge. Verify a real player
   can see them in their quadtree.
3. **Land `Perception` + `ActionAdapter` + `ScriptedBrain`**. Smoke test: a
   scripted brain walks a square. No external surface yet.
4. **Land resident persistence**: parameterise `savePlayerData`/`loadPlayerSave`
   with `{ saveDir }`, add `ResidentSave`/`agentMetadata`, write
   `ResidentRegistry` (create/connect/disconnect/delete + name validation),
   autosave timer. Test: spawn a scripted resident, give it items, restart
   the server, reconnect — items survive.
5. **Land WS gateway + `RemoteBrain` + `ResidentSession`** with
   create/connect/disconnect message handlers wired to the registry.
   Hand-test with `wscat`. Action log writes. `onDisconnect: 'logout'`
   default and `'idle'` variant working.
6. **Land SSE spectator endpoint.**
7. **Land MCP façade behind opt-in dep.** Validate from Claude Desktop /
   claude-code MCP client.
8. **Land tests.** Mark FEATURES.md.

## 16. Open questions

- Do residents count against `World.MAX_PLAYERS = 1600` or get their own pool?
  **Proposed v1: share the pool, configurable cap on the resident fraction
  (default 256 of 1600 reserved for residents).** Reason: combat, chunking
  and quadtree code is uniform on `playerList`; forking the pool means
  threading a new array through every nearby-actor query. Revisit if real
  player counts ever grow.
- Should the perception include map tiles / pathability for the visible area,
  or just actors/objects? **Proposed v1: actors+objects+events only.** Tiles
  blow up the payload (15×15×4 bytes minimum) and most brains don't need it;
  add a `requestTiles: boolean` flag on `attach` if a brain does.
- Per-action rate limit? **Proposed v1: queue depth 4, no per-second cap.**
  Combat actions self-limit via the existing tick cadence; movement is
  capped by walking speed. If LLM controllers misbehave we add a token
  bucket later.
- Authentication on the gateway port? **Proposed v1: bind to localhost,
  optional shared-secret token for remote.** Full auth is a separate spec.
- Autosave cadence — 1000 ticks (~10 min) is a guess. **Proposed v1: keep
  1000 ticks, add `autosaveTicks` to config so it can be tuned without a
  code change.** A faster cadence costs disk I/O; slower means more lost
  work on crash.
- `IdleBrain` policy for unattended residents — eat food at <50% HP is the
  proposed behaviour. **Proposed v1: only that, plus combat retaliation
  (which is already automatic).** No fleeing, no banking. The point of
  `'idle'` is to survive short network blips, not to be smart.
- Should `delete_resident` require a confirmation token? **Proposed v1: no
  token, but gated behind `agentGateway.allowDelete: false` by default.**
  Operators who want it on flip the flag. Avoids accidental loss without
  introducing a stateful confirm flow over WS.

## 17. Trading

### 17.1 Scope

Two trading directions ship in v1: **resident ↔ resident** and
**resident ↔ real player**. The existing shop plugins
(`plugins/npcs/al-kharid/gem-trader.plugin.ts` etc.) handle the unilateral
NPC-shop case; there is no player-to-player trade plugin in this repo today.
This section specs a single `TradeSession` engine that works for every pair
of `Player`s — and because `Resident extends Player`, all three combinations
(P↔P, P↔R, R↔R) fall out of the same code path.

P↔P trade for real players is a side benefit; the trade widget UI for real
players is a separate deliverable but is unblocked by this spec.

### 17.2 Trade flow

Standard four-stage RuneScape flow:

1. **Request.** A initiates `trade_request → B`. B receives a
   `trade_requested` event (resident) or chatbox prompt (real player).
2. **Mutual accept.** B reciprocates with `trade_request → A` while A's
   request is still active (a real player B clicks the chatbox notice
   which routes to the same path). `TradeSession` opens; the partner's
   identity, current offers, and stage are now visible to both sides.
3. **Offer stage.** Either side may `trade_offer_item` (move N of an
   inventory slot into their offer) or `trade_remove_item` (the reverse).
   Each change pushes `trade_offer_updated` to both sides and resets both
   stages to `editing`. Either may `trade_decline` at any time.
4. **First accept.** Each side independently emits `trade_accept_stage_1`.
   When both have, offers freeze (further edits return `ok: false`) and
   the confirmation summary becomes available.
5. **Second accept.** Each side emits `trade_accept_stage_2`. When both
   have, the engine atomically validates and swaps. Failure → both sides
   get `trade_cancelled` with the failure reason. Success → both sides
   get `trade_completed` with the items each received and gave.

### 17.3 `TradeSession` and `TradeEngine`

```
src/engine/world/actor/trade/
    trade-session.ts        # the bilateral state machine
    trade-engine.ts         # global registry: who is trading whom
    trade-events.ts         # event types shared with perceptions
    trade-config.ts         # untradeable item list, max offer slots
```

```ts
type TradeStage = 'editing' | 'accepted_1' | 'accepted_2';

export class TradeSession {
    readonly id: string;
    readonly a: Player;
    readonly b: Player;
    offerA: Item[];   // staged, not yet committed
    offerB: Item[];
    stageA: TradeStage;
    stageB: TradeStage;

    addItem(side: 'a' | 'b', inventorySlot: number, amount: number): TradeResult;
    removeItem(side: 'a' | 'b', offerSlot: number, amount: number): TradeResult;
    requestStage(side: 'a' | 'b', stage: TradeStage): TradeResult;
    decline(side: 'a' | 'b', reason: string): TradeResult;

    private tryCommit(): TradeResult;     // fires when both at accepted_2
    private emitOfferUpdated(): void;     // calls emitToParticipant on both
}

export const TradeEngine = {
    beginRequest(from: Player, to: Player): TradeResult,  // creates or matches pending request
    activeSessionFor(player: Player): TradeSession | null,
    endSessionsFor(player: Player, reason: string): void, // called from logout/handleDeath
};
```

A player can be in at most one session at a time. `beginRequest` rejects
with `EBUSY` if either party already has an active session.

### 17.4 The actor-agnostic emitter

The single bridge between the trade engine and the heterogeneous actor types:

```ts
function emitToParticipant(player: Player, event: TradeEvent): void {
    if (isResident(player)) {
        player.pushPerceptionEvent(event);  // §7 event buffer
    } else {
        // real player: enqueue the appropriate trade widget packets
        TradeWidgetPackets.send(player, event);
    }
}
```

This is the only point in the trade engine that knows about the player /
resident distinction. Everything else (offer mutation, stage transitions,
commit validation) is uniform.

### 17.5 Add "Trade" to `playerOptions`

`playerOptions` (`player.ts:58`) currently has only "Yeet" and "Follow".
Add `'Trade'` (index 2, placement `'TOP'`). The existing
`player-interaction.packet` already routes by index into a
`player_interaction` action with the option string, so once the option
exists a new `plugins/player/trade-request.plugin.ts` can hook
`player_interaction "trade"` and call `TradeEngine.beginRequest`.

Residents being right-clicked just work — they live in the same
`world.playerList` and the inbound packet doesn't care that the target
is headless. The "Trade" option lands on every player and resident in
the vicinity.

### 17.6 New `AgentAction` variants

Added to the union in §8.1:

```ts
| { kind: 'trade_request';       target: ActorRef }
| { kind: 'trade_offer_item';    inventorySlot: number; amount: number }
| { kind: 'trade_remove_item';   offerSlot: number; amount: number }
| { kind: 'trade_accept_stage_1' }
| { kind: 'trade_accept_stage_2' }
| { kind: 'trade_decline'        }
```

The adapter looks up the resident's active session via
`TradeEngine.activeSessionFor(resident)` and dispatches into the
corresponding method. Calling a stage/offer action without an active
session returns `{ ok: false, reason: 'no_active_trade' }`.
`trade_request` against an offline/distant/unknown target returns
`{ ok: false, reason: 'invalid_partner' }`.

### 17.7 New `PerceptionEvent` variants

Added to the union in §7:

```ts
| { kind: 'trade_requested';      from: ActorRef }
| { kind: 'trade_opened';         partner: ActorRef; sessionId: string }
| { kind: 'trade_offer_updated';  ours: ItemRef[]; theirs: ItemRef[];
                                  ourStage: TradeStage; theirStage: TradeStage }
| { kind: 'trade_completed';      received: ItemRef[]; given: ItemRef[] }
| { kind: 'trade_cancelled';      reason: string }
```

Additionally, `Perception.resident` gains an optional
`activeTrade?: TradePerceptionState` so a brain that joins mid-trade
(e.g. on reconnect under `onDisconnect: 'idle'`) sees the current offers
without needing to replay the event stream. `availableActions` (§8.3)
advertises stage transitions and item offers/removes when a session is
active.

### 17.8 Atomicity and validation

- **Untradeable items** (quest items, anything with `tradeable: false` in
  the item config) are rejected at `addItem` time, not at commit. Easier
  for both UIs and gives immediate feedback.
- **Stack overflow**: adding `amount` of an already-offered stack increases
  it; if the resulting stack exceeds the item's max stack size (or
  Int32Max for stackable items), reject at `addItem`.
- **Commit validation**: at second-stage accept on both sides, the engine
  computes hypothetical post-trade inventories. If either side would
  overflow 28 slots given the items it's receiving, cancel with reason
  `'inventory_full'`. Both items lists are returned to their owners
  unchanged.
- **Race on second accept**: `tryCommit()` is guarded by a single boolean;
  first call commits and clears the session, second call no-ops.
- **Offer drift**: every `addItem`/`removeItem` resets both stages to
  `editing` and pushes a fresh `trade_offer_updated`. This prevents
  "I accepted what I thought you were offering" exploits — RuneScape's
  standard rule, retained.

### 17.9 Edge cases

- **Mid-trade death**: `Actor.handleDeath` (and the player override) calls
  `TradeEngine.endSessionsFor(this, 'death')` before drop processing. The
  partner gets `trade_cancelled { reason: 'partner_died' }`.
- **Logout / disconnect mid-trade**: `Player.logout()` calls
  `TradeEngine.endSessionsFor(this, 'logout')`. For residents this fires
  on `disconnect_resident`, on WS drop under `onDisconnect: 'logout'`,
  and on idle-timeout under `'idle'`. Staged offers are returned to the
  owner — no item is lost.
- **Resident controller silent for >3 ticks during a trade**: same noop
  fallback as §13. Trade does not auto-progress; the brain must affirm
  each stage. Real-player partner sees the offer stay frozen at whatever
  stage the resident last reached.
- **Partner moves out of range mid-trade**: existing RS rule is that the
  trade window persists regardless of distance. We mirror that — distance
  is only checked at `trade_request` time (max 1 tile, same as
  player-interact).
- **Resident is offline when a real player tries to trade**: the
  right-click option is only advertised for online actors, so this is
  rare. Engine rejects defensively with `ENO_PARTNER`.

### 17.10 Persistence note

Trade *session state* is not persisted — server restart loses any
in-flight trade. Inventory writes happen only on successful commit and
go through normal `Inventory` mutations, so the resident autosave timer
(§11.4) captures the result on the next save tick. A successful trade
that occurs in the last 10 minutes before a crash survives because the
mutated inventory is what gets saved, not the session.

### 17.11 New file paths summary

```
src/engine/world/actor/trade/
    trade-session.ts
    trade-engine.ts
    trade-events.ts
    trade-config.ts
src/plugins/player/
    trade-request.plugin.ts         # player_interaction "trade" hook
src/engine/net/outbound-packet-handler.ts
    + TradeWidgetPackets helpers    # widget IDs, offer/confirm screens
```

`Player.logout()` and `Actor.handleDeath()` gain one line each:
`TradeEngine.endSessionsFor(this, ...)`. No other actor / combat / inventory
code is modified.

---

## Status checklist

Update as we go. ✅ done · 🟡 in progress · ⬜ not started.

### Headless transport
- ⬜ `Player.initActorOnly()` extraction
- ⬜ `OutboundPacketHandler.socket` nullable
- ⬜ `NullSocket`
- ⬜ `NoopOutboundPacketHandler`
- ⬜ `Resident` class + `isResident` type guard
- ⬜ `World.spawnFakeResidents()` replaces `generateFakePlayers()`

### Perception + actions
- ⬜ `PerceptionBuilder` + types
- ⬜ Event capture hooks (chat, hit, item, level-up, arrived, died)
- ⬜ `AgentAction` union + zod schemas
- ⬜ `ActionAdapter` per-variant implementation
- ⬜ `availableActions` candidate list

### Brain
- ⬜ `Brain` interface
- ⬜ `ScriptedBrain` + goblin-killer fixture
- ⬜ `RemoteBrain`
- ⬜ Prev-tick latency model + timeout → noop fallback

### Persistence
- ⬜ Parameterise `savePlayerData`/`loadPlayerSave`/`playerExists` with `{ saveDir }`
- ⬜ `ResidentSave` shape + `agentMetadata` extension
- ⬜ `data/residents/` directory + `.gitignore`
- ⬜ `res:` name prefix + validation regex (both for residents and a
      blocklist for new player accounts)
- ⬜ `ResidentRegistry.create / connect / disconnect / delete`
- ⬜ Autosave timer (every `autosaveTicks` ticks)
- ⬜ Save-on-shutdown verified via existing `world.kickAllPlayers()` path
- ⬜ `IdleBrain` (eat-at-low-hp, otherwise stand still)
- ⬜ `onDisconnect: 'logout' | 'idle'` policy plumbed end-to-end
- ⬜ Crash-recovery test: kill -9 the server, restart, reconnect, state intact
- ⬜ Save-corruption test: malformed JSON → `ESAVE_CORRUPT` + `.bak` written

### Gateway
- ⬜ `AgentGatewayConfig` in `GameServerConfig`
- ⬜ HTTP+WS server bootstrap (`ws` dep)
- ⬜ `ResidentSession` + per-resident broadcast
- ⬜ Message schemas (zod) + frame parser
- ⬜ `create_resident` / `connect_resident` / `disconnect_resident` /
      `delete_resident` / `list_residents` handlers
- ⬜ Control vs observe role tracking + `ECONTROL_HELD`
- ⬜ SSE spectator endpoint
- ⬜ MCP façade (opt-in dep) + tools

### Logging
- ⬜ Per-resident JSONL action log
- ⬜ Daily rotation
- ⬜ `logFullPerceptions` gate

### Trading
- ⬜ `TradeSession` state machine
- ⬜ `TradeEngine` registry + `beginRequest` / `activeSessionFor` / `endSessionsFor`
- ⬜ `emitToParticipant` actor-agnostic emitter
- ⬜ `Trade` option added to `playerOptions` (`player.ts:58`)
- ⬜ `plugins/player/trade-request.plugin.ts` (`player_interaction "trade"`)
- ⬜ New `AgentAction` variants (request / offer / remove / accept_1 / accept_2 / decline)
- ⬜ New `PerceptionEvent` variants + `Perception.resident.activeTrade`
- ⬜ `TradeWidgetPackets` real-player UI packets
- ⬜ `Player.logout()` + `Actor.handleDeath()` call `endSessionsFor`
- ⬜ Untradeable items + stack-overflow validation at offer time
- ⬜ Commit validation: inventory-room check + atomic swap
- ⬜ Tests: R↔R, R↔P, P↔P happy paths; decline; death; logout;
      inventory-full at commit; race on simultaneous accept_2

### Docs + flags
- ⬜ `-fakeResidents` CLI flag wired
- ⬜ FEATURES.md Residents section
- ⬜ FEATURES.md P2P Trade marked (real-player UI side)
