import type { AgentAdapter } from '../types';

const adapters = new Map<string, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(cliName: string): AgentAdapter | undefined {
  return adapters.get(cliName);
}

export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}

export function getRegisteredAdapter(cliName: string): AgentAdapter | undefined {
  return adapters.get(cliName);
}

export function getRegisteredAdapterNames(): string[] {
  return Array.from(adapters.keys());
}
