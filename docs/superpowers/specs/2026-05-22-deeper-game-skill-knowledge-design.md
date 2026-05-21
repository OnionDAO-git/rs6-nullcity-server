# Deeper Game-Skill Knowledge — Design

**Status:** Draft v1, pending maintainer approval.
**Author:** Claude (with the maintainer during brainstorming).
**Date:** 2026-05-22.
**Supersedes:** the floating "expand knowledge per skill" line items in `feat/runebench-agent-design.md` and the implicit promise in `feat/skill-*.md` that those files would feed runtime prompts.
**Coordinates with:**
- `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — proposes a new **Workstream P (Knowledge Expansion)**; the maintainer assigns the actual letter when promoting to the roadmap.
- `docs/runebench-conventions-adopted.md` § *Knowledge-as-file-per-entity* — this spec is the canonical example of that convention applied at scale.
- `docs/superpowers/specs/2026-05-20-runescape-game-skill-design.md` — engine-side skill ownership. This spec covers *what the agent knows about skills*, not what the engine implements.

**Revision history:**
- v1 (2026-05-22): initial draft from brainstorming the gap between curated `feat/skill-*.md` files and the much thinner `docs/runescape-skill/` consumption layer.

## Why This Spec Exists

The agent currently behaves like a tourist who read one paragraph of the Lumbridge tutorial. Concretely:

1. `src/controller/knowledge/game-skill-entries.ts` ships **five** typed entries (firemaking, fishing, woodcutting, cooking-fish, the starter "use item on item" pattern). The other 18 RuneScape skills are absent or only present via auto-imported `skill-guides/*.json` (short, one-paragraph engine-derived hints).
2. `docs/runescape-skill/` ships four files — `README.md`, `items.md`, `places.md`, `starter-workflows.md` — none of which exceed a handful of starter entities.
3. `feat/skill-*.md` contains seventeen well-curated, implementation-grade skill specs (agility, combat, construction, cooking, crafting, farming, firemaking, fishing, fletching, herblore, mining, prayer, runecrafting, slayer, smithing, thieving, woodcutting). These were written for engine implementers; they have never been promoted into the agent's consumed knowledge layer.
4. There is no per-NPC, per-item, per-place file shape. Agents cannot answer "where do I bank in Falador?", "what does a goblin drop?", or "what should I cook at level 25?" from prompt knowledge alone.
5. Prompt envelopes are already ~30k tokens (perception + module config + memory + history). Naively stuffing seventeen skill specs in would balloon them to unusable.

The result is a resident that can light a fire and fish for shrimp, but cannot meaningfully attempt mining, smithing, combat, prayer, or any skill beyond the tutorial loop — even when the engine fully supports those skills.

This spec adds a **Game-Skill Knowledge Layer** with three properties:

- **Coverage:** all 23 skills, the five starter cities, the bank/guild network, ~30 starter NPCs, weapon/food/tool tiers, and a small set of starter quests.
- **Format discipline:** file-per-entity Markdown for human-edited content; static catalogs in code for typed lookups (item ids, NPC keys, skill ids).
- **Retrieval discipline:** perception- and goal-filtered retrieval that injects ≤ ~1.5k tokens of relevant knowledge per tick, not the whole corpus.

## Goals

- Every one of the 23 RuneScape skills has at least a *starter mini-playbook* (required items, train locations, danger zones, prerequisite skills) consumed by the agent at runtime.
- The agent can answer common spatial questions ("where is the nearest bank?", "is this tile in wilderness?") from a structured world-geography catalog.
- The agent recognizes ~30 starter NPCs (combat fodder, shopkeepers, key quest-givers) by name + kind, and knows their basic drops or services.
- The agent has a tiered item knowledge (weapons by tier, food by heal value, prayer items, tools by skill) sufficient to evaluate inventory contents.
- A handful of starter quests (Cook's Assistant, Restless Ghost, Sheep Shearer, Witch's Potion, Romeo & Juliet) are encoded in enough detail that the agent can opportunistically progress them when adjacent to triggers.
- The knowledge layer respects a hard **per-tick budget** (default 1,500 tokens of retrieved knowledge) and degrades gracefully when more entities match than fit.
- The `feat/skill-*.md` files stop being stranded: every one either feeds the consumed layer (via a documented promotion pipeline) or is explicitly retired with a pointer to its successor.

## Non-Goals

- Hand-authoring a full wiki. Where RuneBench wiki snapshots already cover an entity, we link / clip rather than re-author.
- Encoding combat formulas or XP tables — those belong to the engine and to `feat/skill-combat.md`. The knowledge layer references them; it does not duplicate them.
- Quest *solving*. We give the agent enough awareness to recognize a quest opportunity and the first 1–2 steps; full quest scripting is a separate roadmap item.
- Replacing `src/plugins/skills/skill-guides/*.json` auto-imports. Those are engine-derived and we keep them as a baseline; the new layer augments rather than replaces.
- LLM-augmented knowledge generation. All entries are deterministic (Markdown + typed catalogs). LLM-augmented summarization may be added later as an optimization, not in this spec.
- Multi-agent shared knowledge (faction lore, peer reports). A separate spec owns that.

## Constraints

- TypeScript, Node 24+, existing repo conventions (Zod for schemas, Jest for tests, Biome for lint/format).
- **Static-catalog-in-code invariant for typed lookups.** Item ids, NPC keys, skill ids, place keys are TypeScript constants checked by the type system. Markdown is for prose; it never carries an identifier the runtime depends on.
- **Prompt envelope discipline.** The retrieval layer enforces a per-tick knowledge budget. Default: 1,500 tokens (≈ 6 KB of Markdown) of *retrieved* entries. Exceeding the budget drops the lowest-scored entries; never silently re-balances by trimming inside an entry.
- **Knowledge-as-file-per-entity** (per `runebench-conventions-adopted.md` § *Knowledge-as-file-per-entity*): one Markdown file per skill, place, NPC, item-family, or quest. Filenames are kebab-case keys that match the typed catalog id.
- **No engine duplication.** When an entry needs an engine fact (XP per ore, drop table, NPC stats), it references the engine config path; the runtime can join the entry with the engine config at retrieval time. Hand-copied numbers go stale.
- **Backward compatibility with current `KnowledgeEntry` shape.** `src/controller/knowledge/knowledge-retriever.ts` exports `KnowledgeEntry` with `{ id, title, summary, topics, keywords, source, requiredItems?, actions?, successSignals? }`. New entries fit this shape; we extend it with optional fields rather than break it.
- **No deletion of `feat/skill-*.md` until promoted.** Each `feat/skill-*.md` file remains on disk until its successor (in `docs/runescape-skill/skills/<key>.md` plus a typed catalog entry) lands and a one-line redirect note replaces the body.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Game-Skill Knowledge Layer                       │
│                                                                         │
│   docs/runescape-skill/                                                 │
│     skills/<skill-key>.md          ─┐                                   │
│     places/<place-key>.md          ─┤                                   │
│     npcs/<npc-key>.md              ─┼──► MarkdownLoader ─► KnowledgeEntry[]
│     items/<item-family-key>.md     ─┤                                   │
│     quests/<quest-key>.md          ─┘                                   │
│                                                                         │
│   src/controller/knowledge/                                             │
│     game-skill-entries.ts          ─► ENGINE_KNOWLEDGE_ENTRIES (typed)  │
│     catalogs/skills.ts             ─► SKILL_CATALOG (typed)             │
│     catalogs/places.ts             ─► PLACE_CATALOG (typed)             │
│     catalogs/npcs.ts               ─► NPC_CATALOG (typed)               │
│     catalogs/items.ts              ─► ITEM_FAMILY_CATALOG (typed)       │
│     catalogs/quests.ts             ─► QUEST_CATALOG (typed)             │
│                                                                         │
│   src/plugins/skills/skill-guides/*.json   (engine baseline; kept)      │
│   runebench-wiki/<entity>.md                (optional clips; bounded)   │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                       KnowledgeRetriever.retrieve(
                         perception, goal, budget
                       )
                                  │
                                  ▼
                   Top-k entries (≤ budget tokens) injected
                   into the module prompt envelope.
```

The layer never makes decisions. It provides ranked, budget-trimmed knowledge to the existing module prompt envelope. The SPARK module decides what to do with it.

### Catalog vs. Markdown split

Two stores. One typed, one prose. They are joined by id.

- **Typed catalog (TS).** One entry per skill / place / NPC / item-family / quest. Just the structured fields the runtime needs to *reason* about: id, display name, kind, prerequisite ids, location coords, drop-table reference, etc. Zod-validated on module load.
- **Markdown prose (`docs/runescape-skill/<kind>/<key>.md`).** The human-editable mini-playbook for that entry. Free-form narrative; loaded at startup; clipped at a per-entry character cap during retrieval.

The runtime never reads Markdown for type-level decisions (e.g., "does this item exist?"). It reads the typed catalog. Markdown enters the prompt only via retrieval, only when relevance + budget allow.

### Why this split

The `feat/skill-*.md` files are between 200 and 1,200 lines each. Loading any one of them into the prompt envelope is a non-starter (≥ 4k tokens). The split lets us keep the long-form curation in Markdown for humans, while shipping a 5–15 line *playbook clip* per entity that fits in the prompt.

```
feat/skill-mining.md              (1,200 lines, implementation spec — stays)
              │
              ▼ (one-time curation pass during Plan P-skills batch 1)
              │
docs/runescape-skill/skills/mining.md   (≤ 80 lines, agent-readable playbook)
              │
              ▼ (loaded on startup)
              │
KnowledgeEntry {
  id: 'skill-mining',
  title: 'Skill: Mining',
  summary: <first 600 chars of mining.md>,
  topics: ['mining', 'ore', 'rock', 'pickaxe', 'gem'],
  keywords: [...],
  requiredItems: ['rs:bronze-pickaxe', ...],
  actions: ['object_interaction:mine'],
  successSignals: ['xp:mining', 'inventory:+ore'],
  source: 'docs/runescape-skill/skills/mining.md',
}
```

The same shape applies to places, NPCs, item-families, and quests.

### Retrieval pipeline

Today's `KnowledgeRetriever` does keyword + topic match against a static `ENGINE_KNOWLEDGE_ENTRIES` array. That stays as the floor. We add three orthogonal filters in front of it:

1. **Perception filter.** From the current `Perception`, derive a *perception context*: nearby NPC keys, nearby object/landscape keys, current region key, recent action kinds. Entries whose `topics`/`keywords`/`relatedKeys` overlap perception context get a relevance boost (configurable; default 1.5×).
2. **Goal filter.** From the active `Goal` (in SPARK state) and any plan step, derive a *goal context*: target skill, target item, target place, target quest. Entries matching goal context get a larger boost (default 3×).
3. **Budget trim.** After scoring, entries are added top-down until the per-tick token budget is reached. The trim is at *entry granularity* (drop an entry whole; never half-include one). The last admitted entry is allowed to overshoot by ≤ 200 tokens to avoid pathological cliffs.

Retrieval is otherwise unchanged: scoring still uses the existing token-overlap heuristic; embeddings are explicitly out of scope for v1 (the corpus is small enough that keyword retrieval works, and embeddings would add an inference dependency we currently avoid).

### Maintenance pipeline

A skill, place, NPC, item-family, or quest is added/edited via three coordinated steps:

1. Edit (or create) `docs/runescape-skill/<kind>/<key>.md`.
2. If a new id/key is introduced, add it to the relevant typed catalog in `src/controller/knowledge/catalogs/`.
3. `npm run check-knowledge` (new script in P-skills-batch-1) validates: every catalog key has a Markdown file; every Markdown file has a catalog key; every `requiredItems`/`relatedKeys` reference resolves; Markdown clip length ≤ cap; engine-config cross-references (e.g., `rs:iron-pickaxe`) resolve against `data/config/items/`.

The `check-knowledge` script runs in CI alongside the existing Biome/Jest gates.

### Engine-derived knowledge

Some facts are too volatile to hand-author. We continue to import them from the engine:

- `src/plugins/skills/skill-guides/*.json` → loaded by `skill-guide-importer.ts` (already shipped). The new layer **does not** duplicate skill-guides; it links to them via `engineGuide: 'skill-guides/mining.json'` in the typed catalog.
- `data/config/items/skills/<skill>.json` → item-family entries reference the canonical `rs:` id; the catalog can hydrate the engine row on demand.
- RuneBench wiki snippets (`runebench-wiki/`) → already loaded by `wiki-importer.ts`. Existing `STARTER_WIKI_PAGES` list expands to include the new NPC/place entities.

### Token-budget arithmetic (illustrative)

| Per-tick prompt section | Today | With knowledge layer |
|---|---|---|
| System / module preamble | ~3k | ~3k |
| SOUL summary | ~1.5k | ~1.5k |
| Perception payload | ~6k | ~6k |
| Memory window | ~5k | ~5k |
| Recent history | ~8k | ~8k |
| Retrieved knowledge | ~600 (≤ 3 entries) | ≤ 1,500 (≤ 6 entries) |
| Decision protocol | ~5k | ~5k |
| **Subtotal** | **~29k** | **~30k** |

The knowledge budget grows by ~900 tokens worst-case. We do not allow the rest of the prompt to grow to compensate. This is enforced at runtime by `enforceKnowledgeBudget(entries, maxTokens)` in P-retrieval.

---

## Components

### 1. Typed catalogs

#### 1.1 `catalogs/skills.ts`

```ts
export type SkillKey =
  | 'attack' | 'strength' | 'defence' | 'hitpoints' | 'ranged' | 'prayer' | 'magic'
  | 'cooking' | 'woodcutting' | 'fletching' | 'fishing' | 'firemaking' | 'crafting'
  | 'smithing' | 'mining' | 'herblore' | 'agility' | 'thieving' | 'slayer'
  | 'farming' | 'runecrafting' | 'construction' | 'hunter';

export interface SkillCatalogEntry {
  key: SkillKey;
  displayName: string;
  kind: 'combat' | 'gathering' | 'production' | 'support' | 'utility';
  prerequisiteSkills: SkillKey[];        // e.g. fletching → woodcutting
  engineGuide?: string;                  // path to skill-guides JSON
  starterItems: string[];                // rs: ids
  starterPlaces: PlaceKey[];             // training spots
  dangerLevel: 'safe' | 'mid' | 'danger';
  notes?: string;                        // one-liner, retrieval keywords
}

export const SKILL_CATALOG: Readonly<Record<SkillKey, SkillCatalogEntry>>;
```

The 23-skill list pins RuneScape revision 435: **Hunter is in the type union for forward-compat** but its catalog entry is marked `kind: 'utility'` with `notes: 'engine support partial; do not train'` until engine support lands. We do **not** include Summoning or Dungeoneering (post-435 skills) — they are not in the type union.

#### 1.2 `catalogs/places.ts`

```ts
export type PlaceKey =
  | 'lumbridge' | 'lumbridge-castle' | 'lumbridge-cellar'
  | 'varrock' | 'varrock-east-bank' | 'varrock-west-bank' | 'varrock-castle'
  | 'falador' | 'falador-east-bank' | 'falador-west-bank' | 'falador-park'
  | 'edgeville' | 'edgeville-bank' | 'edgeville-dungeon'
  | 'al-kharid' | 'al-kharid-bank' | 'al-kharid-palace'
  | 'draynor-village' | 'draynor-bank' | 'draynor-manor'
  | 'wilderness-edge' | 'wilderness-deep';

export interface PlaceCatalogEntry {
  key: PlaceKey;
  displayName: string;
  kind: 'city' | 'bank' | 'guild' | 'dungeon' | 'shop' | 'wilderness' | 'landmark';
  region: 'misthalin' | 'asgarnia' | 'kandarin' | 'wilderness' | 'kharidian-desert';
  center: { x: number; y: number; level: number };  // RuneJS world coords
  inCity?: PlaceKey;                                  // parent city
  travelHints: string[];                              // free text, e.g. "From Lumbridge, walk N for 30 tiles"
  banks: PlaceKey[];                                  // banks reachable from this place
  isWilderness: boolean;
  wildernessLevel?: number;                           // 1–55; only when isWilderness
}

export const PLACE_CATALOG: Readonly<Record<PlaceKey, PlaceCatalogEntry>>;
```

The `center` coords let the agent compute "is the nearest bank within N tiles?" without parsing Markdown.

#### 1.3 `catalogs/npcs.ts`

```ts
export type NpcKind = 'combat' | 'shopkeeper' | 'quest-giver' | 'banker' | 'instructor' | 'civic';

export interface NpcCatalogEntry {
  key: string;                          // 'rs:goblin' style; matches engine NPC id mapping
  displayName: string;
  kind: NpcKind;
  combatLevel?: number;
  aggression?: 'passive' | 'aggressive' | 'aggressive-low-level';
  location: PlaceKey[];                 // primary spawn locations
  drops?: string[];                     // rs: item ids; references engine drop table, not duplicate
  servicesOffered?: Array<'bank' | 'general-store' | 'tool-store' | 'food-store' | 'armor-store' | 'weapon-store' | 'rune-store'>;
  questsInvolvedIn?: QuestKey[];
}

export const NPC_CATALOG: Readonly<Record<string, NpcCatalogEntry>>;
```

Initial size: ~30 entries (5 combat fodder, 8 shopkeepers, 10 bankers, 7 quest-givers). NPCs not in the catalog still appear in perception with their engine name; the agent simply has no enriched knowledge for them.

#### 1.4 `catalogs/items.ts`

```ts
export type ItemFamilyKey =
  | 'weapon-melee' | 'weapon-ranged' | 'weapon-magic'
  | 'armor-melee' | 'armor-ranged' | 'armor-magic'
  | 'food-cooked' | 'food-raw'
  | 'tool-pickaxe' | 'tool-axe' | 'tool-fishing' | 'tool-tinderbox' | 'tool-needle' | 'tool-knife' | 'tool-hammer' | 'tool-chisel'
  | 'rune' | 'log' | 'ore' | 'bar' | 'gem' | 'prayer-bone' | 'prayer-altar-item';

export interface ItemFamilyEntry {
  key: ItemFamilyKey;
  displayName: string;
  tiers: Array<{
    tier: 'bronze' | 'iron' | 'steel' | 'mithril' | 'adamant' | 'rune' | 'na';
    rsId: string;                       // engine canonical id
    requiredLevel?: number;             // skill level to wield/use
    skill?: SkillKey;                   // for level gate
    heals?: number;                     // for food
    bonus?: Record<string, number>;     // optional, sparse — typically engine-side
  }>;
  notes?: string;
}

export const ITEM_FAMILY_CATALOG: Readonly<Record<ItemFamilyKey, ItemFamilyEntry>>;
```

This is intentionally a *family* table, not a per-item table. There are too many items in RuneScape 435 to enumerate. The family table covers the lookup the agent actually needs ("what's the best food I have?", "is this pickaxe better than the one I'm holding?"). Per-item enrichment lives in `data/config/items/` (engine-owned) and is joined at retrieval time.

#### 1.5 `catalogs/quests.ts`

```ts
export type QuestKey =
  | 'cooks-assistant' | 'restless-ghost' | 'sheep-shearer'
  | 'witchs-potion' | 'romeo-and-juliet' | 'rune-mysteries';

export interface QuestCatalogEntry {
  key: QuestKey;
  displayName: string;
  startNpc: string;                     // NPC catalog key
  startPlace: PlaceKey;
  requiredSkills: Array<{ skill: SkillKey; level: number }>;
  questPoints: number;
  difficulty: 'novice' | 'intermediate' | 'experienced';
  triggerKeywords: string[];            // for retrieval: 'flour', 'milk', 'egg' for cooks-assistant
  firstSteps: string[];                  // up to 5 bullet steps, agent-readable
  enginePluginPath?: string;            // src/plugins/quests/<key>.ts when implemented
}

export const QUEST_CATALOG: Readonly<Record<QuestKey, QuestCatalogEntry>>;
```

The six-quest starter list is the **minimum opportunistic-progress set** — quests the agent will recognize when adjacent to triggers. Full quest scripting is out of scope.

### 2. Markdown loader

`src/controller/knowledge/markdown-knowledge-loader.ts` (new). One function:

```ts
export function loadGameSkillMarkdown(
  rootDir: string,                       // docs/runescape-skill
  catalogs: KnowledgeCatalogs,           // { skills, places, npcs, items, quests }
  options?: { maxCharsPerFile?: number }
): KnowledgeEntry[];
```

Behavior:

1. Walks `<rootDir>/{skills,places,npcs,items,quests}/*.md`.
2. For each file, parses optional YAML front-matter:

   ```yaml
   ---
   id: skill-mining
   title: 'Skill: Mining'
   topics: [mining, ore, rock, pickaxe, gem]
   keywords: [mine, prospect, copper, tin, iron, coal]
   requiredItems: [rs:bronze-pickaxe, rs:iron-pickaxe]
   actions: [object_interaction:mine]
   successSignals: [xp:mining, inventory:+ore]
   relatedKeys: [place:varrock-east-bank, place:falador-mining-guild]
   ---
   ```

3. Treats the body (≤ `maxCharsPerFile`, default 600) as the `summary`.
4. Validates `id` against the matching catalog key (e.g., `skill-mining` must equal `'skill-' + key` for `key` in `SKILL_CATALOG`). Mismatch is a startup-time error.
5. Returns `KnowledgeEntry[]` ready for `KnowledgeRetriever`.

### 3. Retrieval enhancements

`src/controller/knowledge/knowledge-retriever.ts` gains:

```ts
export interface PerceptionContext {
  nearbyNpcKeys: string[];
  nearbyObjectKeys: string[];
  currentRegion?: string;
  recentActionKinds: string[];
}

export interface GoalContext {
  targetSkill?: SkillKey;
  targetItem?: string;
  targetPlace?: PlaceKey;
  targetQuest?: QuestKey;
}

export interface RetrieveKnowledgeOptions {
  limit?: number;
  minScore?: number;
  perceptionContext?: PerceptionContext;
  goalContext?: GoalContext;
  tokenBudget?: number;                 // default 1500
}
```

The retriever:

1. Scores each entry by keyword/topic overlap (existing behavior).
2. Applies a 1.5× boost if any `relatedKeys` overlap perception context.
3. Applies a 3× boost if any `topics`/`keywords` match goal context.
4. Sorts descending by score.
5. Greedily admits entries until `tokenBudget` is reached (token count = `Math.ceil(summary.length / 4)`).

Returns `KnowledgeResult[]` exactly as today, plus a new optional `budgetTrimmed: boolean` flag on the returned envelope so callers can log when budget is binding.

### 4. The `check-knowledge` script

`scripts/check-knowledge.ts` (new). Wired into `package.json` as `npm run check-knowledge`, runs in CI alongside Biome and Jest.

Validates:

- Every catalog key has a Markdown file (`docs/runescape-skill/<kind>/<key>.md`).
- Every Markdown file's front-matter `id` resolves to a catalog key.
- Every `requiredItems` reference resolves against the engine items config or a catalog item-family `tiers[].rsId`.
- Every `relatedKeys` reference resolves against a catalog key.
- Every `engineGuide`/`enginePluginPath` is a real file.
- Every Markdown body is ≤ `maxCharsPerFile` (default 600). Soft-fail with a warning at 540+.

A non-zero exit fails CI. The script is intentionally chatty — it tells the maintainer exactly which key/file/reference is missing or invalid.

### 5. Promotion of `feat/skill-*.md`

Each `feat/skill-*.md` is curated *down* into `docs/runescape-skill/skills/<key>.md` during P-skills batches. The promotion is a one-way distillation:

| `feat/skill-mining.md` (1,200 lines) | → | `docs/runescape-skill/skills/mining.md` (≤ 80 lines) |
|---|---|---|
| Engine implementation notes | | Dropped (engine-owned) |
| Revision-435 scope | | Compressed to "supported actions" bullet list |
| Bug list / TODO | | Dropped (not agent-relevant) |
| Item / NPC reference tables | | Promoted to `catalogs/items.ts` + `catalogs/npcs.ts` |
| XP tables | | Linked to `skill-guides/mining.json` |
| **Resident-facing playbook** | | **Kept and refined as the new Markdown body** |

When a `feat/skill-X.md` has been promoted, its body is replaced with a one-line redirect:

```markdown
# Mining — Implementation Spec (retired)

This implementation spec has been promoted into the consumed knowledge layer.

- Agent-facing playbook: `docs/runescape-skill/skills/mining.md`
- Engine ownership: `src/plugins/skills/mining/`
- Catalog entry: `src/controller/knowledge/catalogs/skills.ts` → `SKILL_CATALOG.mining`
- Skill guide (engine): `src/plugins/skills/skill-guides/mining.json`

Historical content available in git history at commit <hash>.
```

This preserves the link without leaving 1,200 lines of implementer-grade content stranded.

---

## Data Flow

### Startup

```
ControllerHost.start()
  └─ loadGameSkillMarkdown(docs/runescape-skill, catalogs)
        ├─ walks docs/runescape-skill/{skills,places,npcs,items,quests}/*.md
        ├─ parses YAML front-matter
        ├─ validates ids against catalogs
        └─ returns KnowledgeEntry[] (≈ 80–120 entries at maturity)

  └─ loadSkillGuideKnowledgeEntries(...)   [existing]
  └─ loadRuneBenchWikiSnippets(...)         [existing, list expanded]

  └─ KnowledgeRetriever.constructor(allEntries, catalogs)
```

### Per tick

```
spark.tick(perception)
  └─ module.assemblePrompt({ perception, goal, memory, ... })
        └─ KnowledgeRetriever.retrieve({
             perceptionContext: derivePerceptionContext(perception, catalogs),
             goalContext: deriveGoalContext(state.goal),
             tokenBudget: KNOWLEDGE_TOKEN_BUDGET,  // default 1500
           })
              ├─ score all entries (keyword + topic overlap)
              ├─ apply perception boost (×1.5)
              ├─ apply goal boost (×3.0)
              ├─ sort descending
              └─ greedy admit until budget
        └─ format admitted entries → prompt knowledge section
```

`derivePerceptionContext` is a small pure function in `src/controller/knowledge/context-derivation.ts`. It reads `perception.nearbyNpcs`, `perception.nearbyObjects`, `perception.tile.region`, and `perception.recentActions[-3..]`, mapping each to the appropriate catalog key. Misses are silent (an unknown NPC name simply contributes nothing; it does not throw).

### Maintenance

```
maintainer edits docs/runescape-skill/skills/mining.md
  └─ npm run check-knowledge
        ├─ validates front-matter
        ├─ validates references
        ├─ validates body length
        └─ exits non-zero on any failure

  └─ npm test         (Jest)
  └─ npm run lint     (Biome)
  └─ git commit / push
```

---

## Error Handling

| Failure | Behavior | Visibility |
|---|---|---|
| Markdown file missing front-matter | Skip with warning; do not throw at startup | Logged once |
| Front-matter `id` doesn't match any catalog key | Hard fail at startup | Controller refuses to start |
| Catalog key has no Markdown file | Hard fail in `check-knowledge` CI; soft warning at runtime (entry exists but `summary` is empty) | CI failure |
| Body exceeds `maxCharsPerFile` | Truncated at cap with `...` suffix; `check-knowledge` fails CI | CI failure; runtime continues |
| Perception context derivation throws | Catch; treat perception context as empty; retrieval still works | Logged once per tick (rate-limited) |
| Token budget cannot fit even the highest-scored entry | Admit the entry anyway (overshoot allowed); set `budgetTrimmed = true` and `budgetOvershot = true` | Logged once per tick |
| Engine items config reference doesn't resolve | `check-knowledge` fails CI; at runtime, entry still loads but `requiredItems` is filtered to resolvable ids | CI failure |
| Two Markdown files claim the same `id` | Hard fail at startup | Controller refuses to start |
| Engine config file (e.g., skill-guides/mining.json) referenced from catalog is missing | Soft warning; entry loads without engine join | Logged once |
| Quest plugin path referenced from catalog is missing | Catalog still loads; `enginePluginPath` is treated as null; agent will not attempt quest steps that depend on engine wiring | Logged once |

### Crash safety

The knowledge layer is read-only at runtime. No writes, no temp files, no atomic-rename concerns. Reload semantics: a hot-reload of the catalogs requires a controller restart; we do not support live edit at runtime (file watching adds complexity for no clear gain — knowledge churn happens between sessions).

---

## Testing

### Unit

- `catalogs.test.ts` — every catalog key obeys its key-pattern regex; every entry passes Zod validation; no duplicate keys; `SKILL_CATALOG` has exactly the 23 skills; `prerequisiteSkills` form a DAG (no cycles).
- `markdown-knowledge-loader.test.ts` — fixture trees with valid/invalid front-matter; assert errors, warnings, and final entry shape.
- `context-derivation.test.ts` — perception → context mapping; goal → context mapping; unknown identifiers contribute nothing.
- `knowledge-retriever.test.ts` (extend existing) — boost math for perception and goal contexts; budget trimming; overshoot behavior.

### Integration

- `knowledge-integration.test.ts` — boot a controller fixture with the real `docs/runescape-skill/` and `catalogs/` content; run a scripted perception + goal sequence; assert the retrieved entries for each tick are the expected ones and the token budget is respected.

### CI script

- `check-knowledge.test.ts` — exercises the script against good and bad fixture trees; asserts exit code and stderr content.

### Snapshot

- One stable retrieval-snapshot for a scripted "agent stands in Lumbridge with goal=train mining" tick. Assert the top-5 retrieved entries by id, not by body text. Body text is allowed to evolve as Markdown is refined; the *identity and order* of admitted entries is the contract.

### Coverage smoke

- After P-skills-batch-2 lands, run a single integration smoke that exercises retrieval with goals targeting each of the 23 skills. For each skill, assert the corresponding `skill-<key>` entry is in the top-3 results. No prose assertions.

---

## Decomposition Into Plans

Six plans, each TDD-ready in 2–4 hours. P-retrieval is the only one without external content authoring — it can run in parallel with any of the content batches.

### Plan P-skills-batch-1 — eight skills + scaffolding

- Build typed catalog scaffolding: `catalogs/skills.ts`, the Zod schemas, `markdown-knowledge-loader.ts`, `check-knowledge.ts` script, and CI wiring.
- Author Markdown playbooks for the **eight currently-best-curated skills** in `feat/`: woodcutting, firemaking, fishing, cooking, mining, smithing, crafting, fletching.
- Promote the corresponding `feat/skill-*.md` files (replace bodies with redirect stubs).
- Tests: catalogs unit, loader unit, check-knowledge script.
- **Acceptance:** `SKILL_CATALOG` covers 23 keys (Markdown only for the 8 listed; others are catalog-only with `summary: ''` until P-skills-batch-2); `check-knowledge` passes; existing knowledge tests still pass; controller boots with no warnings.

### Plan P-skills-batch-2 — remaining fifteen skills

- Author Markdown playbooks for the remaining skills: agility, herblore, thieving, slayer, runecrafting, prayer, construction, farming, plus the **seven combat skills** (attack, strength, defence, hitpoints, ranged, magic) as one combined playbook authored from `feat/skill-combat.md`. Hunter ships with a stub noting "engine support partial".
- Promote the corresponding `feat/skill-*.md` files.
- Tests: snapshot covers all 23 skills.
- **Acceptance:** all 23 skills have non-empty `summary`; coverage smoke (one goal per skill) returns the right top-3 result for each.

### Plan P-world-geography — places + travel hints

- Build `catalogs/places.ts` with the five starter cities, their banks, the Edgeville/Wilderness boundary, and key guilds (Mining Guild, Cooks' Guild, etc.).
- Author Markdown for each `PlaceKey` in `docs/runescape-skill/places/`.
- Move existing `docs/runescape-skill/places.md` content into per-place files; replace `places.md` with an index.
- Add `derivePerceptionContext` region recognition.
- Tests: place catalog unit; integration snapshot for "where is the nearest bank?" retrieval.
- **Acceptance:** the agent, given any perception inside a starter city, retrieves the `place-<city>` entry and the nearest `place-<city>-bank` entry in top-5.

### Plan P-npcs-items — NPC roster + item-family catalog

- Build `catalogs/npcs.ts` with ~30 NPC entries (5 combat fodder, 8 shopkeepers, 10 bankers, 7 quest-givers).
- Build `catalogs/items.ts` with the family table (weapons, armor by combat style, food, runes, tools by skill).
- Author Markdown for each NPC and item-family.
- Extend `STARTER_WIKI_PAGES` in `game-skill-entries.ts` to include the new NPC pages from the RuneBench wiki snapshot.
- Tests: NPC catalog unit; item-family catalog unit; integration snapshot for "agent sees a goblin nearby" retrieves `npc-goblin` in top-3.
- **Acceptance:** `check-knowledge` passes with the new entries; every NPC's `drops`/`servicesOffered` resolves; every item-family tier resolves against `data/config/items/`.

### Plan P-quests — six starter quests

- Build `catalogs/quests.ts` with six starter quests (Cook's Assistant, Restless Ghost, Sheep Shearer, Witch's Potion, Romeo & Juliet, Rune Mysteries).
- Author Markdown for each quest in `docs/runescape-skill/quests/`.
- Add quest-trigger keyword recognition: if perception contains a NPC key listed in `QUEST_CATALOG[].startNpc`, boost the quest entry.
- Tests: quest catalog unit; integration snapshot for "agent stands next to Cook in Lumbridge kitchen" retrieves `quest-cooks-assistant` in top-3.
- **Acceptance:** the agent can produce the `firstSteps[0]` for any of the six quests when adjacent to the start NPC. (Whether it *acts* on the step is module-owned, not knowledge-owned.)

### Plan P-retrieval — perception + goal filters, budget enforcement

- Implement `derivePerceptionContext` and `deriveGoalContext`.
- Implement `enforceKnowledgeBudget(entries, maxTokens)` and the budget overshoot rules.
- Extend `KnowledgeRetriever.retrieve()` to accept `PerceptionContext` and `GoalContext`; apply boosts; trim by budget.
- Tests: scoring math; boost math; budget enforcement edge cases; the `budgetTrimmed` and `budgetOvershot` flags.
- **Acceptance:** existing knowledge-retriever tests pass; new boost/budget tests pass; running a real tick with the full catalog never exceeds the configured budget by more than 200 tokens.

### Plan dependencies

- **P-retrieval** is independent and can ship first. It is a no-op without content, but it does not regress existing behavior.
- **P-skills-batch-1** depends on nothing (it builds the scaffolding).
- **P-skills-batch-2** depends on P-skills-batch-1 (uses the scaffolding).
- **P-world-geography**, **P-npcs-items**, and **P-quests** all depend on P-skills-batch-1 (scaffolding) but are independent of each other.
- The full benefit lands when all six are merged. Partial benefit lands incrementally — the retriever is benign without content, and one batch at a time strictly improves coverage.

**Recommended order:** P-retrieval → P-skills-batch-1 → (P-skills-batch-2, P-world-geography, P-npcs-items, P-quests in parallel) → integration smoke.

---

## Open Questions

1. Should retrieval use embeddings? — *Deferred.* The corpus is small (≤ 200 entries even at maturity). Keyword + topic + boost retrieval is sufficient and avoids a model dependency. Revisit if retrieval quality is the bottleneck after all six plans land.
2. Should the catalog be generated from `data/config/` rather than hand-authored? — *Mixed.* Item-family `tiers[]` could be generated from `data/config/items/skills/<skill>.json`; we ship a hand-authored catalog in v1 and revisit codegen if maintenance burden grows.
3. Where do NPC drops live — catalog or engine? — *Engine.* `NpcCatalogEntry.drops` is a *short list of agent-relevant drops* (e.g., "goblin: bones, coins") for retrieval keywords, not the full drop table.
4. Hunter is in the type union but has no engine support today — should we drop it? — *Keep.* Forward-compat; future engine work won't require a type-union churn. The catalog entry's `notes` field marks the gap.
5. Should the knowledge layer expose a runtime API for modules to query a single entry by id? — *Yes; add `KnowledgeRetriever.getById(id)` in P-retrieval.* Useful for module logic that already knows what it wants (e.g., a recipe module asking for `item-family-food-cooked`).
6. Do we keep `docs/runescape-skill/items.md`, `places.md`, `starter-workflows.md` after migration? — *Replace with index files.* The existing READMEs become tables of contents pointing at the per-entity files; we don't delete the human entry points.
7. Should `check-knowledge` also lint engine-config references in `feat/` files? — *No.* `feat/` is implementer territory; only the consumed layer is linted.
8. What happens when revision 435 gets engine updates that change item ids? — *The catalog's `rsId` references break, `check-knowledge` fails CI, maintainer fixes.* This is the desired behavior; we want loud failures on engine drift.

## Risks

- **Authoring fatigue.** Authoring ~120 Markdown files (23 skills + ~20 places + ~30 NPCs + ~20 item-families + 6 quests + index files) is real work. Mitigation: P-skills-batch-1 ships scaffolding + the easiest 8 skills first to validate the shape before the long tail. Each batch is 2–4 hours of focused authoring; total is ~20 hours spread across plans.
- **Prompt envelope creep.** New content invites more retrieval invites bigger prompts. Mitigation: the per-tick budget is enforced in code (P-retrieval) and the snapshot test asserts top-N is stable. A maintainer who adds a 600-char entry can't unilaterally inflate the prompt — they have to also make it the most relevant entry for some perception/goal.
- **Engine drift.** Item ids and NPC keys can change as the engine is refined. Mitigation: `check-knowledge` resolves every reference at CI time; engine changes that break references fail CI immediately, not silently at runtime.
- **`feat/skill-*.md` history loss.** Replacing bodies with redirect stubs means readers see only the redirect; the rich content is in git history. Mitigation: the redirect includes the commit hash where the original body lives; we do **not** delete files. (We also keep a one-time tarball under `feat/.archive/` if the maintainer requests it.)
- **Catalog/Markdown drift.** If a maintainer edits the catalog without updating Markdown (or vice versa), the runtime can disagree with the docs. Mitigation: `check-knowledge` catches both directions (catalog without file, file without catalog).
- **Quest awareness without quest execution.** The agent recognizes Cook's Assistant but can't finish it (engine plugin not implemented). This is fine — the agent should *know* the quest exists so it doesn't blunder. Risk: the agent attempts a quest step that has no engine handler. Mitigation: each quest catalog entry's `enginePluginPath` is checked at startup; missing means the quest is *recognized but not progressed* and module logic respects that flag.
- **Wilderness boundary correctness.** Mistakenly marking a tile as safe when it's wilderness gets residents killed. Mitigation: `PLACE_CATALOG` wilderness entries derive `wildernessLevel` from a small table cross-checked against the engine's wilderness module; CI lints the table against the engine constants.
- **Coordination with Workstream E.** Workstream E (RuneScape Knowledge And Agent Skill) is currently the closest match to this work. The maintainer may decide to fold this spec into E rather than create Workstream P; that's a roadmap call, not a design call. The spec is independent of the chosen letter.

## RuneBench Convention Adoption

This spec is the canonical example of two conventions from `docs/runebench-conventions-adopted.md`:

- **Knowledge-as-file-per-entity** — every skill, place, NPC, item-family, and quest is one file. We extend the convention with explicit catalog/Markdown split and the `check-knowledge` CI gate.
- **Static catalog in code for typed lookups** — item ids, NPC keys, skill ids, place keys, quest keys are TypeScript constants. Markdown never carries a runtime-depended-on identifier.

Other conventions (3-tier reward, failure taxonomy, trajectory normalization, probe-then-loop) are unrelated to this spec.

## Workstream Placement

Proposed as **Workstream P (Knowledge Expansion)** in `2026-05-20-runescape-agent-roadmap.md`. Letters A–O are taken; P–Z are available. The maintainer assigns the actual letter at promotion time; the spec is letter-independent. If the maintainer prefers to extend the existing Workstream E (RuneScape Knowledge And Agent Skill) rather than create a new workstream, the six plans slot under E without restructure — the deliverables and acceptance criteria are unchanged.

## Multi-Agent Coordination Notes

- This spec owns `src/controller/knowledge/catalogs/*`, `src/controller/knowledge/markdown-knowledge-loader.ts`, `src/controller/knowledge/context-derivation.ts`, the new `docs/runescape-skill/{skills,places,npcs,items,quests}/` trees, `scripts/check-knowledge.ts`, and redirect-stub edits to `feat/skill-*.md`.
- Codex (branch `nullcity`) currently owns combat-prayer module and benchmark CLI. The knowledge layer does not touch those, but P-skills-batch-2's combat playbook authoring should coordinate timing with Codex (the playbook's prose may reference module behavior).
- Dev (separate repo) owns the dashboard. The dashboard does not currently render knowledge entries; if it begins to, the `KnowledgeEntry` shape is the cross-repo contract — additive only.
- All roadmap edits go through the standard roadmap-delta flow (see `docs/agent-coordination.md`).
