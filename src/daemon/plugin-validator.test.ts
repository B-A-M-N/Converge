/// <reference types="vitest" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PluginValidator } from './plugin-validator';
import type { PluginManifest } from './plugin-types';

vi.mock('../adapters/registry', () => ({
  listAdapters: vi.fn(),
  getAdapter: vi.fn(),
}));

import { getAdapter } from '../adapters/registry';

describe('PluginValidator', () => {
  const baseManifest: PluginManifest = {
    name: 'test-plugin',
    version: '1.0.0',
    adapter: 'test',
    cli_names: ['test-cli'],
    apiVersion: '1.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getAdapter as any).mockReturnValue({ name: 'test' });
  });

  describe('validateManifest', () => {
    it('rejects missing name', () => {
      const manifest = { ...baseManifest, name: '' };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.field === 'name')).toBe(true);
    });

    it('rejects invalid name pattern (uppercase)', () => {
      const manifest = { ...baseManifest, name: 'TestPlugin' };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.message.includes('lowercase'))).toBe(true);
    });

    it('rejects missing version', () => {
      const manifest = { ...baseManifest, version: '' };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.field === 'version')).toBe(true);
    });

    it('rejects invalid semver', () => {
      const manifest = { ...baseManifest, version: 'invalid' };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.message.includes('Invalid semver'))).toBe(true);
    });

    it('rejects missing adapter', () => {
      const manifest = { ...baseManifest, adapter: '' };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.field === 'adapter')).toBe(true);
    });

    it('rejects missing cli_names', () => {
      const manifest = { ...baseManifest, cli_names: [] };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.message.includes('cli_names'))).toBe(true);
    });

    it('rejects duplicate cli_names', () => {
      const manifest = { ...baseManifest, cli_names: ['test', 'test'] };
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
    });

    it('rejects missing apiVersion', () => {
      const manifest = { ...baseManifest };
      // @ts-ignore — remove apiVersion
      delete manifest.apiVersion;
      const errors = PluginValidator.validateManifest(manifest, '/fake/path');
      expect(errors.some(e => e.field === 'apiVersion')).toBe(true);
    });
  });

  describe('validateAdapterExistence', () => {
    it('returns true for existing adapter (test)', () => {
      expect(PluginValidator.validateAdapterExistence('test')).toBe(true);
    });

    it('returns false for non-existent adapter', () => {
      (getAdapter as any).mockReturnValueOnce(undefined);
      expect(PluginValidator.validateAdapterExistence('nonexistent')).toBe(false);
    });
  });

  describe('validateVersionCompatibility', () => {
    it('accepts matching major version', () => {
      expect(PluginValidator.validateVersionCompatibility('1.0.0')).toBe(true);
      expect(PluginValidator.validateVersionCompatibility('1.5.2')).toBe(true);
    });

    it('rejects mismatched major version', () => {
      expect(PluginValidator.validateVersionCompatibility('2.0.0')).toBe(false);
      expect(PluginValidator.validateVersionCompatibility('0.9.0')).toBe(false);
    });

    it('rejects empty/missing version', () => {
      expect(PluginValidator.validateVersionCompatibility('')).toBe(false);
      expect(PluginValidator.validateVersionCompatibility(undefined as any)).toBe(false);
    });
  });
});
