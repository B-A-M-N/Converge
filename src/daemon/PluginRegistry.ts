import { getAdapter, listAdapters } from '../extensions/registry';
import { PluginMetadata, PluginManifest, PLUGIN_EVENTS } from './plugin-types';
import { AgentAdapter } from '../types';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { valid, major } from 'semver';

/**
 * PluginRegistry
 *
 * Central registry for plugin discovery, validation, loading, lifecycle management,
 * and adapter resolution.
 *
 * Lifecycle:
 * 1. Startup: loadAll() scans configured directories, validates, loads in dependency order
 * 2. Runtime: createJob() queries resolveAdapterForCLI() to get adapter for job.cli
 * 3. Shutdown: unloadAll() calls onUnload hooks
 *
 * Singleton pattern: getInstance() returns the global registry.
 * DI alternative: ControlPlane receives registry via constructor (preferred for testability).
 *
 * Invariants:
 * - Never crashes daemon: all plugin errors caught and logged
 * - Never blocks startup indefinitely: timeouts on all hooks
 * - Deterministic resolution: order = built-in > plugin dirs order > alphabetical manifest filename
 */
export class PluginRegistry {
  private static instance: PluginRegistry | null = null;

  /** Map of plugin name -> metadata */
  private plugins: Map<string, PluginMetadata> = new Map();

  /** Built-in adapter names (highest priority) */
  private readonly BUILT_IN_ADAPTERS = ['gemini', 'codex', 'opencode', 'kimi', 'test'];

  /** Configuration (injected or from config module) */
  private pluginDirectories: string[] = [];
  private pluginLoadTimeoutMs: number = 10000;
  private pluginUnloadTimeoutMs: number = 5000;

  private constructor() {}

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  /**
   * Initialize registry with configuration.
   * Must be called before loadAll().
   */
  configure(directories: string[], loadTimeoutMs?: number, unloadTimeoutMs?: number): void {
    this.pluginDirectories = directories;
    if (loadTimeoutMs) this.pluginLoadTimeoutMs = loadTimeoutMs;
    if (unloadTimeoutMs) this.pluginUnloadTimeoutMs = unloadTimeoutMs;
  }

  /**
   * Main entry point: discover, validate, and load all plugins.
   *
   * Algorithm:
   * 1. Scan each configured directory for *.plugin.json (top-level only, non-recursive)
   * 2. Parse and validate each manifest
   * 3. Check adapter existence and version compatibility
   * 4. Build dependency graph
   * 5. Topological sort (Kahn's algorithm) to determine load order
   * 6. Load plugins in order, calling onLoad hooks with timeout
   * 7. Mark status accordingly; never throw or abort on errors
   *
   * Errors are logged with structured JSON and plugin is marked 'error' or skipped.
   */
  async loadAll(): Promise<void> {
    const manifests: PluginManifest[] = [];
    const manifestPaths: Map<string, string> = new Map(); // name -> file path

    // Step 1: Discovery
    for (const dir of this.pluginDirectories) {
      if (!existsSync(dir)) {
        continue;
      }
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.plugin.json')) {
          continue;
        }
        if (file.startsWith('.')) {
          continue; // hidden files
        }
        const fullPath = join(dir, file);
        try {
          const raw = readFileSync(fullPath, 'utf-8');
          const manifest = JSON.parse(raw) as PluginManifest;
          manifests.push(manifest);
          manifestPaths.set(manifest.name, fullPath);
        } catch (err: any) {
          this.logEvent(PLUGIN_EVENTS.VALIDATION_ERROR, {
            plugin: 'unknown',
            status: 'rejected',
            reason: `Failed to read/parse JSON: ${err.message}`,
            path: fullPath,
          });
        }
      }
    }

    // Step 2: Validate each manifest and create metadata
    const pluginQueue: { manifest: PluginManifest; path: string }[] = [];
    for (const manifest of manifests) {
      const path = manifestPaths.get(manifest.name)!;
      const metadata = this.createPluginMetadata(manifest, path);
      if (metadata === null) {
        continue; // validation failed, already logged
      }
      pluginQueue.push({ manifest, path });
      this.plugins.set(manifest.name, metadata);
    }

    // Step 3: Build dependency graph for topological sort
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const [name, meta] of this.plugins) {
      graph.set(name, meta.dependencyNames);
      inDegree.set(name, meta.dependencyNames.length);
    }

    // Also account for plugins that are dependencies of others (for cycle detection)
    for (const [name, deps] of graph) {
      for (const dep of deps) {
        if (!inDegree.has(dep)) {
          inDegree.set(dep, 0); // missing dependency, will be handled later
        }
      }
    }

    // Step 4: Kahn's algorithm
    const loadOrder: string[] = [];
    const queue: string[] = [];

    // Start with nodes having in-degree 0
    for (const [name, deg] of inDegree) {
      if (deg === 0 && this.plugins.has(name)) {
        queue.push(name);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      loadOrder.push(current);

      // Decrement in-degree of dependents
      for (const [name, deps] of graph) {
        if (deps.includes(current)) {
          const newDeg = (inDegree.get(name) ?? 1) - 1;
          inDegree.set(name, newDeg);
          if (newDeg === 0) {
            queue.push(name);
          }
        }
      }
    }

    // Detect cycles: nodes that were in the graph but not in loadOrder
    const cycleNodes = Array.from(inDegree.keys()).filter(
      (name) => inDegree.get(name)! > 0 && this.plugins.has(name)
    );

    if (cycleNodes.length > 0) {
      this.logEvent(PLUGIN_EVENTS.DEPENDENCY_CYCLE, {
        plugins: cycleNodes,
        reason: 'Circular dependency detected',
      });
      // Mark all cycle participants as error
      for (const name of cycleNodes) {
        const meta = this.plugins.get(name);
        if (meta) {
          meta.status = 'error';
          meta.error = 'Circular dependency';
        }
      }
    }

    // Step 5: Load plugins in topological order (skip ones with missing deps)
    for (const name of loadOrder) {
      const meta = this.plugins.get(name)!;
      try {
        // Check if any dependency is not loaded (missing)
        const missingDeps = meta.dependencyNames.filter((dep) => !this.plugins.has(dep) || this.plugins.get(dep)?.status !== 'loaded');
        if (missingDeps.length > 0) {
          meta.status = 'error';
          meta.error = `Missing dependencies: ${missingDeps.join(', ')}`;
          this.logEvent(PLUGIN_EVENTS.SKIP, {
            plugin: name,
            reason: meta.error,
          });
          continue;
        }

        await this.loadPlugin(meta);
      } catch (err: any) {
        meta.status = 'error';
        meta.error = err.message;
        this.logEvent(PLUGIN_EVENTS.ERROR, {
          plugin: name,
          reason: `Load failed: ${err.message}`,
        });
      }
    }

    // Summary log
    const loadedCount = Array.from(this.plugins.values()).filter((p) => p.status === 'loaded').length;
    const errorCount = Array.from(this.plugins.values()).filter((p) => p.status === 'error').length;
    console.log(JSON.stringify({
      event: 'plugins_load_complete',
      loaded: loadedCount,
      errors: errorCount,
      total: this.plugins.size,
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Load a single plugin module and initialize it.
   */
  private async loadPlugin(meta: PluginMetadata): Promise<void> {
    const { manifest } = meta;

    try {
      // Dynamic import the plugin module
      const module = await import(meta.modulePath);
      const pluginExports = module.default || module;

      // Extract hooks (optional)
      meta.hooks = {
        onLoad: typeof pluginExports.onLoad === 'function' ? pluginExports.onLoad : undefined,
        onUnload: typeof pluginExports.onUnload === 'function' ? pluginExports.onUnload : undefined,
        onJobCreated: typeof pluginExports.onJobCreated === 'function' ? pluginExports.onJobCreated : undefined,
      };

      // Adapter must be the default export (or module itself if it's an object)
      if (typeof pluginExports !== 'object' || pluginExports === null) {
        throw new Error('Plugin default export must be an AgentAdapter object');
      }

      // Verify adapter implements AgentAdapter shape (duck type)
      if (typeof pluginExports.detect !== 'function' || typeof pluginExports.startRun !== 'function') {
        throw new Error('Default export missing required AgentAdapter methods');
      }

      meta.adapterInstance = pluginExports as AgentAdapter;
      meta.loadTime = new Date();

      // Call onLoad hook with timeout
      if (meta.hooks.onLoad) {
        await this.withTimeout(
          () => meta.hooks!.onLoad!(manifest.config || {}),
          this.pluginLoadTimeoutMs,
          `onLoad timeout (${this.pluginLoadTimeoutMs}ms)`
        );
      }

      meta.status = 'loaded';
      this.logEvent(PLUGIN_EVENTS.LOAD, {
        plugin: manifest.name,
        version: manifest.version,
        adapter: manifest.adapter,
        cli_names: manifest.cli_names,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      meta.status = 'error';
      meta.error = err.message;
      this.logEvent(PLUGIN_EVENTS.ERROR, {
        plugin: manifest.name,
        reason: `Load plugin failed: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      throw err; // propagate to caller
    }
  }

  /**
   * Resolve an adapter for the given CLI name.
   *
   * Order of precedence:
   * 1. Built-in adapters (highest priority)
   * 2. Loaded plugins in registration order (pluginDirectories order then alphabetical manifest)
   * 3. Exact case-sensitive match
   *
   * Returns null if no adapter found.
   */
  resolveAdapterForCLI(cliName: string): AgentAdapter | null {
    // 1. Built-in adapters (from registry)
    const allBuiltIn = listAdapters();
    const builtInMatch = allBuiltIn.find((a: string) => a === cliName);
    if (builtInMatch) {
      return getAdapter(builtInMatch) ?? null;
    }

    // 2. Plugin adapters (only loaded ones)
    for (const [name, meta] of this.plugins) {
      if (meta.status !== 'loaded') {
        continue;
      }
      const match = meta.manifest.cli_names.find((c) => c === cliName);
      if (match) {
        return meta.adapterInstance;
      }
    }

    return null;
  }

  /**
   * Get all successfully loaded plugins (status === 'loaded').
   */
  getAllLoaded(): PluginMetadata[] {
    return Array.from(this.plugins.values()).filter((p) => p.status === 'loaded');
  }

  /**
   * Call onJobCreated hook on all loaded plugins (fire-and-forget, non-blocking).
   */
  onJobCreated(event: { jobId: string; spec: any; actor: string; timestamp: string }): void {
    for (const meta of this.getAllLoaded()) {
      if (meta.hooks.onJobCreated) {
        try {
          meta.hooks.onJobCreated(event);
        } catch (err: any) {
          // Must not affect job creation
          console.error(JSON.stringify({
            event: 'plugin.hook_error',
            plugin: meta.manifest.name,
            hook: 'onJobCreated',
            error: err.message,
            jobId: event.jobId,
            timestamp: new Date().toISOString(),
          }));
        }
      }
    }
  }

  /**
   * Unload all plugins (call onUnload hooks). Used during graceful shutdown.
   */
  async unloadAll(): Promise<void> {
    const loaded = this.getAllLoaded();
    for (const meta of loaded) {
      if (meta.hooks.onUnload) {
        try {
          await this.withTimeout(
            () => meta.hooks!.onUnload!(),
            this.pluginUnloadTimeoutMs,
            `onUnload timeout (${this.pluginUnloadTimeoutMs}ms)`
          );
        } catch (err: any) {
          console.error(JSON.stringify({
            event: 'plugin.unload_error',
            plugin: meta.manifest.name,
            reason: err.message,
            timestamp: new Date().toISOString(),
          }));
          // Continue unload; do not block shutdown
        }
      }
    }
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  /**
   * Validate a manifest file and create PluginMetadata if valid.
   * Returns null if validation fails (errors logged).
   */
  private createPluginMetadata(manifest: PluginManifest, path: string): PluginMetadata | null {
    const errors: string[] = [];

    // Required fields
    if (!manifest.name) {
      errors.push('Missing required field: name');
    } else if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      errors.push(`Invalid name pattern: must be lowercase alphanumeric + hyphens`);
    }

    if (!manifest.version) {
      errors.push('Missing required field: version');
    } else if (!valid(manifest.version)) {
      errors.push(`Invalid semver: ${manifest.version}`);
    }

    if (!manifest.adapter) {
      errors.push('Missing required field: adapter');
    } else {
      // Check adapter exists in registry (built-in or already loaded plugin)
      if (!getAdapter(manifest.adapter)) {
        errors.push(`Adapter '${manifest.adapter}' not found in registry`);
      }
    }

    if (!manifest.cli_names || manifest.cli_names.length === 0) {
      errors.push('Missing required field: cli_names (must be non-empty array)');
    } else {
      const seen = new Set<string>();
      for (const cli of manifest.cli_names) {
        if (typeof cli !== 'string' || cli.trim() === '') {
          errors.push('cli_names must be non-empty strings');
        } else if (seen.has(cli)) {
          errors.push(`Duplicate cli_name: ${cli}`);
        }
        seen.add(cli);
      }
    }

    if (!manifest.apiVersion) {
      errors.push('Missing required field: apiVersion');
    } else {
      const DAEMON_API_VERSION = '1.0';
      const pluginMajor = major(manifest.apiVersion) as number;
      const daemonMajor = major(DAEMON_API_VERSION) as number;
      if (pluginMajor !== daemonMajor) {
        errors.push(`API version mismatch: plugin requires ${manifest.apiVersion}, daemon is ${DAEMON_API_VERSION} (major version must match)`);
      }
    }

    // Capabilities: unknown keys → warning only
    if (manifest.capabilities) {
      for (const key of Object.keys(manifest.capabilities)) {
        const KNOWN_CAPABILITIES = ['job_created', 'job_completed', 'job_failed', 'daemon_started', 'daemon_stopped'];
        if (!KNOWN_CAPABILITIES.includes(key as any)) {
          console.warn(JSON.stringify({
            event: 'plugin.capability_unknown',
            plugin: manifest.name,
            capability: key,
            reason: 'Unknown capability flag (warning only)',
            timestamp: new Date().toISOString(),
          }));
        }
      }
    }

    // Dependencies: default empty array
    const deps = manifest.dependencies ?? [];

    if (errors.length > 0) {
      for (const err of errors) {
        this.logEvent(PLUGIN_EVENTS.VALIDATION_ERROR, {
          plugin: manifest.name,
          status: 'rejected',
          reason: err,
          path,
        });
      }
      return null;
    }

    return {
      manifest,
      modulePath: path, // will be replaced after import resolution in loadPlugin
      hooks: {},
      adapterInstance: null as any, // placeholder, set during loadPlugin
      status: 'pending',
      dependencyNames: deps,
      dependents: [],
    };
  }

  /**
   * Run a function with a timeout.
   */
  private async withTimeout<T>(
    fn: () => T | Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  /**
   * Structured logging helper.
   */
  private logEvent(eventType: string, data: any): void {
    console.error(JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      ...data,
    }));
  }
}
