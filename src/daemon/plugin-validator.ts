import { getAdapter } from '../adapters/registry';
import { PluginManifest } from './plugin-types';

/**
 * Validation error structure.
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Plugin manifest validation logic.
 *
 * All validation functions are pure and side-effect-free.
 * Logging is handled by caller.
 */
export class PluginValidator {
  /**
   * Validate manifest structure and content.
   * Returns empty array if valid, or array of error messages.
   */
  static validateManifest(manifest: PluginManifest, manifestPath: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Required fields
    if (!manifest.name) {
      errors.push({ field: 'name', message: 'Missing required field: name' });
    } else if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      errors.push({ field: 'name', message: 'Invalid name pattern: must be lowercase alphanumeric + hyphens' });
    }

    if (!manifest.version) {
      errors.push({ field: 'version', message: 'Missing required field: version' });
    } else if (!this.isValidSemver(manifest.version)) {
      errors.push({ field: 'version', message: `Invalid semver: ${manifest.version}` });
    }

    if (!manifest.adapter) {
      errors.push({ field: 'adapter', message: 'Missing required field: adapter' });
    }

    if (!manifest.cli_names || manifest.cli_names.length === 0) {
      errors.push({ field: 'cli_names', message: 'Missing required field: cli_names (must be non-empty array)' });
    } else {
      const seen = new Set<string>();
      for (const cli of manifest.cli_names) {
        if (typeof cli !== 'string' || cli.trim() === '') {
          errors.push({ field: 'cli_names', message: 'cli_names must be non-empty strings' });
        } else if (seen.has(cli)) {
          errors.push({ field: 'cli_names', message: `Duplicate cli_name: ${cli}` });
        }
        seen.add(cli);
      }
    }

    if (!manifest.apiVersion) {
      errors.push({ field: 'apiVersion', message: 'Missing required field: apiVersion' });
    }

    // Capabilities: unknown keys → warning (not error)
    if (manifest.capabilities) {
      for (const key of Object.keys(manifest.capabilities)) {
        // Known capabilities are checked by caller; we accept any here.
      }
    }

    return errors;
  }

  /**
   * Check if adapter name exists in the adapter registry.
   */
  static validateAdapterExistence(adapterName: string): boolean {
    try {
      return !!getAdapter(adapterName);
    } catch {
      return false;
    }
  }

  /**
   * Check API version compatibility.
   * Returns true if major versions match.
   */
  static validateVersionCompatibility(apiVersion: string): boolean {
    if (!apiVersion) return false;
    const DAEMON_API_VERSION = '1.0';
    try {
      const pluginMajor = this.semverMajor(apiVersion);
      const daemonMajor = this.semverMajor(DAEMON_API_VERSION);
      return pluginMajor === daemonMajor;
    } catch {
      return false;
    }
  }

  // Helper: check if string is valid semver
  private static isValidSemver(version: string): boolean {
    // Use regex to avoid semver package dependency in validator
    // Basic pattern: X.Y.Z where X, Y, Z are numbers, optionally with pre-release/build
    return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.\-]+)?(?:\+[\w.\-]+)?$/.test(version);
  }

  // Helper: get major version
  private static semverMajor(version: string): number {
    const match = version.match(/^(\d+)\./);
    if (!match) throw new Error(`Invalid semver: ${version}`);
    return parseInt(match[1], 10);
  }
}
