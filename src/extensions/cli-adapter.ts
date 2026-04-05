/**
 * Generic CLI Adapter interface.
 *
 * This interface defines the contract for any CLI agent (Claude Code, Gemini CLI,
 * Codex, Kimi, etc.) to integrate with Converge's daemon IPC via ConvergeClient.
 *
 * Implementations should NOT modify ConvergeClient — they layer on top of it.
 */

import { Actor } from '../types';
import { ConvergeClient } from '../client/ConvergeClient';

export interface CliAdapterCommand {
  /** The action to perform (e.g., 'add', 'ls', 'pause', etc.) */
  name: string;
  /** Arguments passed to the command */
  args: string[];
  /** Named options (e.g., { every: '5m', task: 'run tests', cli: 'test' }) */
  options: Record<string, unknown>;
}

export interface CliAdapterResponse {
  /** 'success' | 'error' | 'info' */
  status: 'success' | 'error' | 'info';
  /** Human-readable message */
  message: string;
  /** Optional structured data payload */
  data?: unknown;
}

/**
 * Generic adapter interface for CLI agent integrations.
 *
 * Every CLI agent (Claude Code, Gemini CLI, Codex, Kimi) implements this interface.
 * The adapter is responsible for:
 * - Providing a configured ConvergeClient instance
 * - Resolving the Actor for attribution on mutating operations
 * - Translating command input into ConvergeClient method calls
 * - Formatting responses for the specific CLI agent's UX conventions
 */
export interface CliAdapter {
  /** Returns the name of this CLI agent (e.g., 'claude-code') */
  readonly name: string;

  /** Returns a ConvergeClient instance configured for this adapter */
  getSocketPath(): string;
  /**
   * Resolves the Actor for attribution on mutating operations.
   * Must return a deterministic identity — never anonymous.
   */
  resolveActor(): Promise<Actor>;

  /** Execute a command on the ConvergeClient and return a formatted response */
  execute(
    client: ConvergeClient,
    command: CliAdapterCommand,
    actor: Actor
  ): Promise<CliAdapterResponse>;
}
