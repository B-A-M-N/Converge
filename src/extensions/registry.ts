/**
 * Extensions registry — bootstraps built-in adapters.
 * extensions/index.ts uses require('./registry') at runtime.
 */
import { registerAdapter, getAdapter, listAdapters, getRegisteredAdapter, getRegisteredAdapterNames } from '../adapters/registry';
import { claudeHeadlessAdapter } from '../adapters/claude-headless';
import { claudeSessionAdapter } from '../adapters/claude-session';
import { codexSessionAdapter } from '../adapters/codex-session';
import { claudeAdapter } from '../adapters/claude';
import { testAdapter } from '../adapters/test';

// Register built-in adapters on first import
if (!getAdapter('claude-headless')) registerAdapter(claudeHeadlessAdapter);
if (!getAdapter('claude-session')) registerAdapter(claudeSessionAdapter);
if (!getAdapter('codex-session')) registerAdapter(codexSessionAdapter);
if (!getAdapter('claude')) registerAdapter(claudeAdapter);
if (!getAdapter('test')) registerAdapter(testAdapter);

export { registerAdapter, getAdapter, listAdapters, getRegisteredAdapter, getRegisteredAdapterNames };
