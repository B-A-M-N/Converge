/**
 * Plugin System Type Definitions
 * Phase 29: Plugin Registry Enhancement
 */

import { AgentAdapter } from '../types';

// ============================================================================
// Hook Function Types
// ============================================================================

/**
 * Called after manifest validation, before daemon starts accepting requests.
 * Used to initialize plugin resources, validate environment, register custom routes.
 */
export type OnLoad = (config: object) => Promise<void> | void;

/**
 * Called during graceful shutdown (after accepting stops).
 * Used to clean up resources, close connections, flush buffers.
 */
export type OnUnload = () => Promise<void> | void;

/**
 * Called after a job is created and the job.created event is emitted.
 * Used for plugin-specific bookkeeping, telemetry, or transformation.
 */
export interface JobCreatedEvent {
  jobId: string;
  spec: any; // Full JobSpec from client
  actor: string; // actor.actorId from Actor object
  timestamp: string; // ISO timestamp
}

export type OnJobCreated = (event: JobCreatedEvent) => void;

// ============================================================================
// Plugin Manifest (from *.plugin.json)
// ============================================================================

/**
 * Plugin manifest schema.
 * Fields required unless marked optional.
 *
 * Naming: lowercase alphanumeric + hyphens only (e.g., "gemini-adapter")
 */
export interface PluginManifest {
  /** Unique plugin identifier */
  name: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Name of registered adapter class (must exist in adapter registry) */
  adapter: string;

  /** CLI tool names this plugin handles. At least one required. */
  cli_names: string[];

  /** Declared capability flags (optional, default all false) */
  capabilities?: Record<string, boolean>;

  /** Dependencies on other plugins by name (optional, default []) */
  dependencies?: string[];

  /** Plugin-specific configuration passed to onLoad (optional, default {}) */
  config?: object;

  /** Required Converge API version (e.g., "1.0") */
  apiVersion: string;
}

// ============================================================================
// Plugin Metadata (runtime state)
// ============================================================================

/**
 * Runtime metadata for a loaded plugin.
 * Stored in PluginRegistry internal map keyed by plugin name.
 */
export interface PluginMetadata {
  /** The manifest as parsed and validated */
  manifest: PluginManifest;

  /** Absolute path to the plugin's compiled .js module */
  modulePath: string;

  /** Hook functions (if defined in module) */
  hooks: {
    onLoad?: OnLoad;
    onUnload?: OnUnload;
    onJobCreated?: OnJobCreated;
  };

  /** Resolved AgentAdapter instance from adapter registry */
  adapterInstance: AgentAdapter;

  /** When the plugin was successfully loaded */
  loadTime?: Date;

  /** Current loading status */
  status: 'pending' | 'loaded' | 'error';

  /** Error message if status === 'error' */
  error?: string;

  /** Dependencies that must be loaded before this plugin */
  dependencyNames: string[];

  /** Dependents that depend on this plugin (for cycle detection) */
  dependents: string[];
}

// ============================================================================
// Capability Model
// ============================================================================

/**
 * Known capability flags (advisory only — not enforced in v2.0).
 * Plugins declare these to document intended surface area.
 *
 * Technical enforcement not implemented (trusted plugin model).
 * Violations are contract breaches detectable via audit.
 */
export const KNOWN_CAPABILITIES = [
  'control',
  'events',
  'enforcement_read',
  'artifacts_read',
  'diagnostics_read',
] as const;

// ============================================================================
// Events
// ============================================================================

/**
 * Structured logging event types for plugin lifecycle.
 */
export const PLUGIN_EVENTS = {
  LOAD: 'plugin.load',
  SKIP: 'plugin.skip',
  ERROR: 'plugin.error',
  HOOK_TIMEOUT: 'plugin.hook_timeout',
  DEPENDENCY_CYCLE: 'plugin.dependency_cycle',
  VALIDATION_ERROR: 'plugin.validation_error',
  UNLOAD: 'plugin.unload',
} as const;
