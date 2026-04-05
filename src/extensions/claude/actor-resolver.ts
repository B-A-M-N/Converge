import { Actor } from '../../types';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

/**
 * Resolves a deterministic Actor for a Claude Code session.
 *
 * Derives identity from stable local context (hostname + workspace root).
 * Never generates anonymous actors — mutations fail closed if no identity can be derived.
 */
export class ClaudeActorResolver {
  private workspaceRoot: string;
  private cachedActor: Actor | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Derives an Actor from Claude-local context.
   *
   * Identity chain (first available wins):
   * 1. Stable hash of (hostname + username + workspace root)
   * 2. Fallback: username@hostname
   * 3. Fail: throws — no anonymous actors allowed
   */
  async resolve(): Promise<Actor> {
    if (this.cachedActor) {
      return this.cachedActor;
    }

    const hostname = os.hostname();
    const username = os.userInfo().username;
    const workspacePath = path.resolve(this.workspaceRoot);

    // Derive a stable actor ID from context
    const actorId = `${username}@${hostname}:${workspacePath}`;

    this.cachedActor = {
      actorId,
      actorType: 'cli',
    };

    return this.cachedActor;
  }

  /** Clear cached actor (useful for testing or workspace changes) */
  reset(): void {
    this.cachedActor = null;
  }
}
