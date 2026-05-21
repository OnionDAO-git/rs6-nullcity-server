# SPARK Module Authoring

This is the short guide for reviewed in-repo SPARK modules. Dynamic third-party modules from SOUL files, memory files, package installs, or remote URLs are not supported.

## Current Boundary

- `onion.runescape.standard` is the default reviewed module.
- SOUL files may select bundled modules and pass data-only config.
- `TrustedSparkModuleContext` is internal compatibility glue for reviewed adapters, not the public OnionDAO member API.
- Member-safe authoring depends on the safe facades in `src/controller/spark/module-context.ts`, `module-memory.ts`, `module-inference.ts`, and `module-telemetry.ts`.
- Same-process TypeScript is not a sandbox. Do not treat arbitrary code as safe until a separate sandbox/artifact policy exists.

## Add A Reviewed Module

1. Add the module under `src/controller/spark/` or a focused subdirectory.
2. Declare a `SparkModuleManifest` with stable `id`, `version`, `displayName`, `owner`, `risk: 'reviewed'`, and exact `capabilities`.
3. Expose only facets that the manifest declares. The registry rejects undeclared thinking, nervous rules, hooks, candidates, prompt sections, attempt observers, and benchmarks.
4. Today, only thinking and nervous compatibility facets are wired as callable runtime module facets. Treat hooks, candidates, prompt sections, attempt observers, and benchmarks as planned capabilities until the roadmap marks their runtime wiring complete.
5. Use safe facades for new member-style code. Avoid raw `MemoryStore`, raw `RuntimeState`, raw `LlmClient`, filesystem paths, endpoints, API keys, and process environment.
6. Add focused Jest tests for config validation, capability enforcement, telemetry, memory namespace behavior, inference budget behavior, and any gameplay decisions.
7. Register the module in `standardSparkModules()` only after tests and review.

## Verify

```bash
npm test -- --runInBand src/controller/spark
npm run typecheck
npm run lint
npm run build
```

For gameplay modules, also run a benchmark or live smoke and record the artifact or dashboard observation in the roadmap.
