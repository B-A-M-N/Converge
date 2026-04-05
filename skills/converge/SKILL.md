---
name: converge
description: Create and manage recurring agent tasks with explicit stop conditions. Activate when the user wants to monitor, retry, poll, or re-run work on an interval.
version: 0.1.0
---

# Converge

Converge is a recurring task engine for CLI AI agents. Use it when the user asks to:
- Run something on a schedule ("every 5 minutes", "every hour")
- Poll until a condition is met ("check until tests pass", "wait for the PR to merge")
- Retry work on failure ("keep trying until it succeeds")
- Monitor something over time ("watch the deploy", "check for drift")

## Creating a Task

Always require three things before creating a task:
1. **Interval** — how often to run (e.g. `5m`, `1h`, `30s`)
2. **Task** — what to do (a prompt or slash command)
3. **Stop condition** — when to stop

If the stop condition is missing, infer a safe default:
- "until tests pass" → exit code 0
- "until merged" → output contains "merged"
- No hint provided → max 10 iterations

Use `/converge-add` to create the task.

## Managing Tasks

- `/converge-ls` — list all jobs
- `/converge-status <job-id>` — get job details
- `/converge-pause <job-id>` — pause a running job
- `/converge-resume <job-id>` — resume a paused job
- `/converge-cancel <job-id>` — delete a job
- `/converge-run-now <job-id>` — trigger immediate execution
- `/converge-logs <job-id>` — view run history
- `/converge-doctor` — check system health

## Preferences

- Prefer bounded runs: use max iterations or a deadline stop condition
- Prefer explicit stop conditions over open-ended polling
- Check `/converge-doctor` if a job isn't running as expected
