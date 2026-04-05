# Extension Manifest Specification

**Applies to:** v2.0 Plugin Registry Enhancement
**Status:** Stable
**Document:** Manifest schema, capability model, lifecycle hooks, validation rules

---

## Purpose

Plugins extend Converge with custom adapter implementations for specific CLI agents (Gemini, Codex, Kimi, etc.). The manifest enables:

- Safe startup-only discovery
- Explicit capability declaration
- Adapter registration and resolution
- Lifecycle management

---

## Manifest Location and Naming

- **Directory**: Configured in daemon config as `pluginDirectories` (array of absolute paths)
  - Default: `[<appData>/plugins, "./plugins"]`
- **File pattern**: `*.plugin.json` (must have `.plugin.json` extension)
- **Scanning**: All matching files in all directories are read at daemon startup (before accepting requests)

---

## Manifest Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique plugin identifier (lowercase, alphanumeric + hyphens). Example: `"gemini-adapter"` |
| `version` | `semver` | Semantic version (e.g., `"1.0.0"`). Used for compatibility checks. |
| `adapter` | `string` | Name of the registered adapter class (must exist in adapter registry). Example: `"GeminiAdapter"` |
| `cli_names` | `string[]` | CLI tool names this plugin handles. At least one required. Example: `["gemini", "gemini-cli"]` |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `capabilities` | `object` | all `false` | Declared capability flags (see below) |
| `dependencies` | `string[]` | `[]` | Names of other plugins this plugin depends on (for load ordering) |
| `config` | `object` | `{}` | Plugin-specific configuration passed to `onLoad` |

### Capability Flags

Plugins must declare what capabilities they require. These are **informational contract declarations**, not OS-level permission checks. The daemon enforces that plugin actions are limited to the declared surfaces.

| Capability | Meaning | Enforcement |
|------------|---------|-------------|
| `control` | Plugin can schedule/cancel jobs via ControlPlane | If `false`, adapter's `createJob` should reject or be no-op |
| `events` | Plugin can subscribe to event streams | If `false`, event subscription methods should reject |
| `enforcement_read` | Plugin can query leases/constraints | If `false`, read methods throw `CapabilityDeniedError` |
| `artifacts_read` | Plugin can read run logs/outputs | If `false`, artifact access methods reject |
| `diagnostics_read` | Plugin can query system state/metrics | If `false`, diagnostics methods reject |

**Note:** v2.0 does **not** implement sandboxing. Capability enforcement is advisory—plugin code is trusted not to bypass. However, the adapter interface should respect these flags, and violations are considered bugs or malicious behavior.

---

## Example Manifest

```json
{
  "name": "gemini-adapter",
  "version": "1.0.0",
  "adapter": "GeminiAdapter",
  "cli_names": ["gemini", "gemini-cli"],
  "capabilities": {
    "control": true,
    "events": true,
    "enforcement_read": true,
    "artifacts_read": false,
    "diagnostics_read": true
  },
  "dependencies": [],
  "config": {
    "max_jobs_per_minute": 60
  }
}
```

---

## Lifecycle Hooks

Plugins may define optional hook functions exported from their module.

### `onLoad(config: object): Promise<void>`

- **When:** Immediately after manifest validation, before daemon starts accepting requests
- **Purpose:** Initialize plugin resources, validate environment, register custom routes
- **Args:** `config` from manifest `config` field
- **Failure:** If throws or rejects, plugin is **rejected** and error is logged. Daemon startup continues without this plugin.
- **Async:** Yes; daemon awaits with timeout (10s default)

### `onUnload(): Promise<void>`

- **When:** During graceful shutdown (after `SIGTERM`, before stopping listeners)
- **Purpose:** Clean up resources, close connections, flush buffers
- **Args:** None
- **Failure:** If throws or rejects, daemon logs error but continues shutdown anyway (best effort)
- **Timeout:** 5s; if not complete, daemon proceeds

### `onJobCreated(event: JobCreatedEvent): void`

- **When:** After ControlPlane has created a job and emitted `job.created` event
- **Purpose:** Plugin-specific bookkeeping, telemetry, or transformation
- **Args:** `event` includes `jobId`, `spec`, `actor`
- **Failure:** Must not throw; if exception occurs, catch and log internally. Job creation is not affected.
- **Async:** No (synchronous only). For async work, fire-and-forget with error handling.

**JobCreatedEvent:**
```typescript
interface JobCreatedEvent {
  jobId: string;
  spec: JobSpec;
  actor: Actor;
  timestamp: string; // ISO
}
```

---

## Adapter Registration

Adapters are classes implementing the `AgentAdapter` interface (defined in `src/adapters/`). Registration occurs via:

```typescript
// In adapter module
import { registerAdapter } from '../adapters/registry';
registerAdapter(GeminiAdapter);
```

**At job creation time:**
- `job.cli` field (string) is matched against all registered plugin's `cli_names` arrays
- Exact match required (case-sensitive)
- First matching plugin wins (order: built-in then plugin scan order)
- If no match, `ValidationError`: `Unsupported CLI: ${job.cli}`

**Performance:** Matching cached at job creation; O(1) lookup after initial scan.

---

## Validation Rules

During startup scan, daemon validates each `*.plugin.json`:

1. **Schema**: All required fields present and correct types
2. **Adapter existence**: `adapter` class must be registered (either built-in or previously loaded plugin)
3. **Capability flags**: All boolean; no unknown fields (warn only)
4. **CLI names**: Non-empty strings; no duplicates across plugins (warning if duplicate, later plugin wins)
5. **Dependencies**: All declared dependencies exist; cycles detected → error
6. **Version**: Semver parseable

**Invalid manifest handling:**
- Log error with file path and reason
- Skip plugin; continue startup
- Do not block daemon from starting

---

## Loading Order

1. Built-in adapters registered (hard-coded)
2. Scan `pluginDirectories` in order
3. For each `*.plugin.json`:
   - Parse manifest
   - Validate manifest
   - Load plugin module (Node.js `require()`)
   - Call `onLoad()` if present
   - Register adapter (already done by module side-effect)
4. After all plugins loaded, daemon begins accepting requests

**Dependencies:** Simple topological sort. Plugin A depends on B → B loaded before A. If cycle, reject both with error.

---

## Security and Safety

**No dynamic runtime loading:** Plugins are loaded only at daemon startup. To add/remove plugins, restart daemon.

**No code download:** Plugins must exist on local filesystem. No network fetching.

**No sandbox (v2.0):** Plugins run in same Node.js process with same privileges as daemon. Malicious plugin can do anything daemon can do. This is **trusted plugin** model.

**Principle of least privilege:** Use capability flags to document intent. Future versions may add optional sandboxing (`isolated-vm`) for untrusted plugins, but v2.0 does not.

**Capability enforcement:** Adapter methods should respect declared capabilities. For example, if plugin declares `events: false`, its adapter's `subscribe` method should throw `CapabilityDeniedError`. This is contract, not technical enforcement.

---

## Unload and Hot Reload

**v2.0 policy: No hot reload.** Plugins are loaded once at startup and remain until daemon exit.

- `onUnload` called only during graceful shutdown (SIGTERM)
- To update a plugin: stop daemon, replace files, restart
- To remove a plugin: delete manifest before restart; jobs using that plugin's CLI will fail validation on creation

**Rationale:** Hot reload introduces complex state cleanup and reference lifetime issues. Defer to v3.0+.

---

## Debugging and Observability

- Daemon logs plugin load success/failure at startup (INFO and ERROR levels)
- `listPlugins` CLI command (proposed) shows loaded plugins, versions, capabilities
- Hook errors logged with stack traces
- Plugin exceptions during operation caught and logged; do not crash daemon (unless memory corruption)

---

## Common Pitfalls

- **Missing adapter registration**: Plugin module must call `registerAdapter()` on load; otherwise `adapter` field points to non-existent class
- **Circular dependencies**: `A depends on B` and `B depends on A` causes load failure; keep dependencies unidirectional
- **Capability mismatch**: Plugin declares `events: false` but tries to subscribe; runtime error. Ensure declared capabilities match actual usage.
- **Long `onLoad`**: Blocking startup for 30s is unacceptable. Keep `onLoad` fast; async work should be offloaded.
- **File permissions**: Plugin files must be readable by daemon user; otherwise skipped

---

## Implementation Notes for Phase 29

1. **Config extension**: Add `pluginDirectories: string[]` to daemon config (`config.json`).
2. **Scanner**: Read directory, filter `*.plugin.json`, parse JSON
3. **Loader**: `require(pluginModulePath)`; must export `onLoad`, `onUnload` if present
4. **Registry**: Extend existing `AdapterRegistry` with `plugins: PluginManifest[]` array and `resolveAdapterForCLI(cliName)` method
5. **Validation**: Schema validation; adapter existence; dependency resolution
6. **Lifecycle**: Store hook functions; call at appropriate times (startup, shutdown, job creation)
7. **Job creation hook**: After `ControlPlane.createJob` emits `job.created`, invoke `plugin.onJobCreated` if defined

---

## Verification Tests

Phase 29 must verify:

- [ ] Manifest schema validation (missing fields, wrong types)
- [ ] Adapter existence check
- [ ] Dependency resolution and cycle detection
- [ ] `onLoad` called before daemon starts
- [ ] `onUnload` called on graceful shutdown
- [ ] `onJobCreated` called after job creation
- [ ] Plugin rejection does not crash daemon
- [ ] CLI matching works: `job.cli` resolves to correct adapter
- [ ] Misbehaving plugin (throw in `onJobCreated`) does not fail job creation

---

*Document version: 1.0 — 2026-03-26*
