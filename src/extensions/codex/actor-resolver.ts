import { Actor } from '../../types';
import * as os from 'os';
import * as path from 'path';

/**
 * Resolves a deterministic Actor for a Codex CLI session.
 *
 * Identity is derived from stable local context (username + hostname + workspace root).
 * The `:codex` suffix distinguishes Codex actors from Claude Code actors in the audit trail.
 */
export class CodexActorResolver {
  private workspaceRoot: string;
  private cachedActor: Actor | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Derives an Actor from Codex-local context.
   *
   * Actor ID format: `username@hostname:/abs/workspace:codex`
   */
  async resolve(): Promise<Actor> {
    if (this.cachedActor) {
      return this.cachedActor;
    }

    const hostname = os.hostname();
    const username = os.userInfo().username;
    const workspacePath = path.resolve(this.workspaceRoot);

    this.cachedActor = {
      actorId: `${username}@${hostname}:${workspacePath}:codex`,
      actorType: 'cli',
    };

    return this.cachedActor;
  }

  reset(): void {
    this.cachedActor = null;
  }
}
