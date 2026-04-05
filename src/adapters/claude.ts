import { claudeHeadlessAdapter } from './claude-headless';
import type { AgentAdapter } from '../types';

/**
 * Default `claude` adapter — resolves to claude-headless.
 * Use `claude-session` for jobs that should be executed by an active Claude Code session.
 * Use `claude-headless` explicitly to make the daemon subprocess contract clear.
 */
export const claudeAdapter: AgentAdapter = {
  ...claudeHeadlessAdapter,
  name: 'claude',
};
