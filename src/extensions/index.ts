/**
 * Extensions module — CLI agent integrations that build on top of ConvergeClient.
 *
 * Each extension is a thin adapter that implements CliAdapter for a specific CLI agent.
 * No extension modifies ConvergeClient, daemon handlers, plugin registry, or core runtime types.
 */

export { CliAdapter, CliAdapterCommand, CliAdapterResponse } from './cli-adapter';

export function getAdapter(cliName: string): any {
  // Thin adapter lookup — delegates to registered adapters
  const { getRegisteredAdapter } = require('./registry');
  return getRegisteredAdapter(cliName);
}

export function getAdapters(): string[] {
  const { getRegisteredAdapterNames } = require('./registry');
  return getRegisteredAdapterNames();
}
