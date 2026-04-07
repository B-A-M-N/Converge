---
name: converge
description: Schedule recurring tasks, poll until conditions are met, retry on failure, or monitor over time. Activate when the user wants to run something on an interval or loop.
version: 0.1.0
---

# Converge — Codex Session Integration

Converge is a recurring task engine. Use it when the user asks to:
- Run something on a schedule ("every 5 minutes", "every hour")
- Poll until a condition is met ("check until tests pass", "wait for the PR to merge")
- Retry on failure ("keep trying until it succeeds")
- Monitor something over time ("watch the deploy", "check for drift")

## How Codex Uses Converge

Codex is a **session-owned executor**. The daemon tracks schedules and state; your session executes the work.

Flow for each run:
1. Detect a due `codex-session` job (via scheduler or hook)
2. `converge claim-run <job-id>` — reserve the run, get back a `runId` and `task`
3. Execute the task using your own tools
4. `converge complete-run <run-id> --exit-code <n> [--stdout "..."] [--stderr "..."]` — record the result

The daemon decides whether to continue or stop based on your stop condition.

## Creating a Task

Always require three things before creating a task:
1. **Interval** — how often to run (`5m`, `1h`, `30s`)
2. **Task** — what to do (describe it clearly)
3. **Stop condition** — when to stop

If the stop condition is missing, infer a safe default:
- "until tests pass" → exit code 0
- "until merged" → output contains "merged"
- No hint provided → max 10 iterations

```sh
converge add --task "run npm test" --every 5m --cli codex-session --stop-condition '{"type":"exitCode","value":0}'
```

**Always use `--cli codex-session`** for Codex-owned jobs.

## Executing a Due Job

When you detect a job that is due (or when asked to run one now):

```sh
# 1. Claim the run
result=$(converge claim-run <job-id>)
RUN_ID=$(echo $result | jq -r .runId)
TASK=$(echo $result | jq -r .task)
CWD=$(echo $result | jq -r .cwd)

# 2. Execute the task in the job's working directory
# (use your own tools here)

# 3. Submit the result
converge complete-run $RUN_ID --exit-code 0 --stdout "task output here"
```

If `claim-run` fails with "has an active run", another process already claimed it — skip.

## Management Commands

```sh
converge ls                        # list all jobs
converge get <job-id>              # job details and last run
converge pause <job-id>            # pause a job
converge resume <job-id>           # resume a paused job
converge rm <job-id>               # delete a job
converge logs <job-id>             # run history
converge doctor                    # daemon health check
```

## Preferences

- Prefer bounded runs: use `max_iterations` or a deadline stop condition
- Prefer explicit stop conditions over open-ended polling
- Run `converge doctor` if a job isn't executing as expected
- Use `converge get <job-id>` to check `next_run_at` and current state
