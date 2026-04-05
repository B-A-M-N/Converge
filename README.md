<p align="center">
  <img src="assets/logo.png" alt="Converge" width="480" />
</p>

<p align="center">
  <strong>A persistent, agent-aware task execution engine with stop-condition convergence.</strong>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-white.svg" />
  <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-green" />
  <img alt="Version" src="https://img.shields.io/badge/version-2.0.0-blue" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-785%2F787-brightgreen" />
  <img alt="Storage" src="https://img.shields.io/badge/storage-SQLite-lightblue" />
  <img alt="Cloud" src="https://img.shields.io/badge/cloud-none-brightgreen" />
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey" />
</p>

---

```bash
npm install -g .
```

**New to CLI agents or automation?** Read the [Beginner's Guide](FOR_BEGINNERS.md) first.

---

## Is This For Me?

If you have ever wanted an agent to "keep trying until it works" and then walked away — yes.

You don't need to understand the architecture to use it. The quick start is two commands. The daemon starts itself. The hard parts (lease enforcement, crash recovery, event sourcing) are invisible until something goes wrong, at which point they're exactly what you want.

If a shell script with `sleep 300` would have solved your problem, Converge will solve it better with one command and an audit log. If you need multiple agents coordinating work across sessions, it scales to that too.

---

## Why I Built This

I work almost exclusively through CLI agents — Claude, Gemini, Codex, and others. When I discovered the `/loop` command in Claude Code, my immediate reaction was: *this should exist for every agent, not just one.* At the same time, I kept running into the limits of what a session-bound loop can actually do. It dies when the session ends. It can't be triggered by another agent. There's no history, no stop conditions, no way to pause or recover.

Converge is the answer to both questions at once: a universal recurring task primitive that any CLI agent can use, built to be more capable than a simple loop from the ground up.

---

## Converge vs. `/loop`

| | `/loop` (Claude Code) | Converge |
|---|---|---|
| Survives session end | No | Yes |
| Survives Claude restart | No | Yes |
| Works with Gemini, Codex, etc. | No | Yes |
| External trigger (`run-now`) | No | Yes |
| Another agent can enqueue it | No | Yes |
| Job state (pause / resume / cancel) | No | Yes |
| Run history and logs | No | Yes |
| Stop conditions | No | Yes |
| Multiple concurrent jobs | No | Yes |
| Actor attribution | No | Yes |

---

## Why Not Just Cron?

Cron schedules commands. Converge schedules *tasks that converge toward outcomes*.

| | Cron | Converge |
|---|---|---|
| Runs arbitrary commands | Yes | Yes |
| Agent-aware execution | No | Yes |
| Structured stop conditions | No | Yes |
| Persistent run history | No | Yes |
| Job lifecycle (pause / resume / cancel) | No | Yes |
| Cross-agent triggering | No | Yes |
| Stateful evaluation between runs | No | Yes |
| Crash recovery | No | Yes |

Cron fires and forgets. Converge fires, evaluates, and decides whether to fire again.

---

## System Model

Converge is a deterministic job execution engine built around four contracts:

1. **Job Definition** — A task, interval, agent adapter, and optional stop condition. Immutable after creation.
2. **Execution** — One run per tick, enforced by a single-writer lease. No overlapping executions.
3. **Evaluation** — After each run, stop conditions are evaluated deterministically against the output.
4. **State** — All transitions are event-sourced. Every run produces a persisted result.

### Job Lifecycle

<p align="center">
  <img src="assets/job-lifecycle.png" alt="Job Lifecycle State Machine" width="720" />
</p>

---

## How It Works

<p align="center">
  <img src="assets/architecture.png" alt="Converge Architecture" width="720" />
</p>

The daemon runs independently of any agent session. Jobs are defined over a Unix domain socket, executed on schedule via subprocess, and evaluated against stop conditions after each run. All state is written to `~/.converge/`. If the daemon restarts, all jobs and run history are recovered from SQLite.

**Cross-agent triggering** — one agent can enqueue a job that runs a different agent entirely:

<p align="center">
  <img src="assets/cross-agent-trigger.png" alt="Cross-Agent Trigger Flow" width="720" />
</p>

---

## Execution Guarantees

- **At-most-one active execution per job** — lease enforcement prevents concurrent runs of the same job
- **No silent failures** — every run produces a persisted result: `success`, `failed`, or `error`
- **Deterministic stop evaluation** — conditions are evaluated against the full run output after each tick, not approximated
- **Ordered event log** — all state transitions are recorded with actor identity and timestamp
- **Crash-safe scheduling** — if the daemon dies mid-run, the lease expires and the job is rescheduled cleanly on restart

## Failure Semantics

- **Agent crash** → run marked `failed`, exit code recorded, next scheduled tick proceeds normally
- **Daemon crash** → all job state recovered from SQLite on restart; stale leases are reclaimed automatically
- **Adapter not found** → run marked `error` immediately, logged, schedule continues
- **Stop condition parse error** → job creation rejected at definition time, never silently ignored
- **Socket unavailable** → CLI auto-relaunches the daemon and retries before surfacing an error

---

## Quick Start

```bash
# Install globally from the repo root
npm install -g .

# Run any command — the daemon starts automatically on first use
converge ls

# Create a job: ask claude to run tests every 5 minutes until they pass
converge add --task "run the integration test suite and fix any failures" \
             --every 5m \
             --cli claude \
             --stop '{"type":"exitCode","code":0}'

# Inspect
converge ls
converge logs <job-id>
```

The daemon launches automatically in the background on first use. You do not need to start it manually.

---

## CLI Reference

### `converge add`

Create a new recurring job.

```bash
converge add --task "<prompt or command>" --every <interval> [options]
```

| Flag | Description |
|---|---|
| `--task <text>` | The task or prompt to pass to the agent on each run |
| `--every <interval>` | How often to run — duration (`5m`, `1h`, `30s`) or cron expression |
| `--cli <name>` | Agent adapter to use. Default: `claude` |
| `--stop <json>` | Stop condition as JSON (see [Stop Conditions](#stop-conditions)) |

**Examples:**

```bash
# Run every 10 minutes until tests pass
converge add --task "run npm test and fix any failures" \
             --every 10m --cli claude \
             --stop '{"type":"exitCode","code":0}'

# Run on a cron schedule indefinitely
converge add --task "summarize open PRs" --every "0 9 * * 1-5" --cli gemini
```

---

### `converge ls`

List all jobs with current state, schedule, and next run time.

---

### `converge status <job-id>`

Get full job details as JSON.

---

### `converge logs <job-id>`

View the run history for a job. Each entry includes status, start/end times, and exit code.

```bash
converge logs <job-id>
converge logs <job-id> --json   # raw JSON
```

---

### `converge pause <job-id>`

Pause a job. The scheduler skips it until resumed. Any run already in progress finishes.

---

### `converge resume <job-id>`

Resume a paused job and return it to the active schedule.

---

### `converge cancel <job-id>`

Permanently remove a job from the schedule. Run history is preserved.

---

### `converge run-now <job-id>`

Trigger an immediate out-of-schedule execution. The regular schedule continues afterwards.

---

### `converge explain <job-id>`

Human-readable explanation of a job's current state, configuration, and recent run history.

---

### `converge doctor`

Active environment probe. Checks adapter availability, database connectivity, and filesystem access.

---

### `converge daemon`

Start the daemon in the foreground. Under normal use this is unnecessary — the daemon launches automatically. Use this for debugging or to run it under a process supervisor.

```bash
converge daemon
```

The socket is created at `~/.converge/converge.sock`. Override with `CONVERGE_SOCKET_PATH`.

---

## Stop Conditions

Stop conditions tell Converge when a job is done. Pass them as JSON to `--stop`.

<p align="center">
  <img src="assets/stop-condition-evaluator.png" alt="Stop Condition Evaluation" width="720" />
</p>

### Exit Code

Stop when the agent process exits with a specific code.

```json
{"type": "exitCode", "code": 0}
```

### Stdout Matches

Stop when the agent's stdout matches a regex pattern.

```json
{"type": "stdoutMatches", "pattern": "all tests passed"}
```

### Compound

Combine conditions with `any` (OR) or `all` (AND).

```json
{
  "type": "compound",
  "operator": "any",
  "conditions": [
    {"type": "exitCode", "code": 0},
    {"type": "stdoutMatches", "pattern": "all tests passed"}
  ]
}
```

With `"operator": "any"`, the job stops as soon as one condition is met.
With `"operator": "all"`, every condition must be met on the same run.

If no stop condition is provided, the job runs on its schedule until manually cancelled.

---

## Supported Adapters

| Adapter | CLI invoked | Notes |
|---|---|---|
| `claude` | `claude` | Supports session continuation via `--resume` |
| `gemini` | `gemini` | New subprocess per run |
| `codex` | `codex` | New subprocess per run |
| `kimi` | `kimi` | New subprocess per run |
| `opencode` | `opencode` | New subprocess per run |
| `test` | `echo` | For local testing and development |

The `claude` adapter supports session continuation — subsequent runs resume the previous conversation context rather than starting fresh.

---

## Data Storage

<p align="center">
  <img src="assets/data-storage.png" alt="Converge Data Storage" width="600" />
</p>

All data is stored locally in `~/.converge/`. Nothing leaves your machine.

---

## Daemon Management

The daemon launches automatically on first use. For production or always-on setups, run it under a process supervisor.

### systemd (Linux)

```ini
[Unit]
Description=Converge Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/converge daemon
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable converge
systemctl --user start converge
```

### launchd (macOS)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.converge.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/converge</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.converge.daemon.plist
```

---

## Claude Code Plugin

Converge ships a native Claude Code plugin that lets Claude create and manage recurring jobs directly from a conversation — no manual CLI invocation required.

### Installation

```bash
claude plugin install /path/to/converge
```

### How It Works

- **Skill** (`skills/converge/SKILL.md`) — Teaches Claude when to reach for Converge. Activates automatically when the user asks to monitor, retry, poll, or schedule work.
- **Commands** (`commands/converge-*.md`) — Slash commands that invoke the `converge` CLI. Available in any Claude Code session once installed.

### Available Commands

| Command | Description |
|---|---|
| `/converge-add` | Create a new recurring task |
| `/converge-ls` | List all jobs |
| `/converge-status <job-id>` | Get full job details |
| `/converge-pause <job-id>` | Pause a job |
| `/converge-resume <job-id>` | Resume a paused job |
| `/converge-cancel <job-id>` | Delete a job permanently |
| `/converge-run-now <job-id>` | Trigger immediate execution |
| `/converge-logs <job-id>` | View run history |
| `/converge-doctor` | Check system health |

---

## Troubleshooting

### Commands not appearing in Claude Code

1. Confirm the plugin is installed: `claude plugin list` should show `converge-loop`
2. Run `/reload-plugins` in Claude Code
3. If that fails, restart Claude Code — plugins load at session start
4. Verify `commands/` exists at the plugin root and contains `.md` files

### Daemon not starting

```bash
# View daemon logs
tail -f ~/.converge/daemon.log

# Start manually to see errors directly
converge daemon

# Check if a socket already exists (daemon may already be running)
ls -la ~/.converge/converge.sock
```

### Jobs not running

```bash
converge doctor          # verify all systems healthy
converge ls              # confirm job state is active (not paused or cancelled)
converge logs <job-id>   # inspect last run output and exit code
```

### Adapter not found

```bash
converge doctor   # lists available adapters
which claude      # verify the CLI binary is on your PATH
```

---

## Contributing

Pull requests are welcome. There is no rigid process — open an issue to discuss what you want to change, or just send the PR.

A few things that would genuinely be useful:

- **New adapters** — if you use a CLI agent that isn't listed, adding an adapter is straightforward (see `src/adapters/`)
- **Stop condition types** — `convergence` is partially stubbed and would benefit from a real implementation
- **Windows support** — the daemon uses Unix sockets; named pipes would get it working on Windows
- **Bug reports** — if something breaks, open an issue with the output of `converge doctor` and `converge logs <job-id>`

The test suite is strict but the bar for contribution isn't. If you are not sure whether something is worth a PR, open an issue first and ask. The worst answer is "not right now."

---

## Status

| | |
|---|---|
| Version | 2.0.0 |
| Tests | 785 / 787 passing |
| Storage | SQLite, local only |
| Platforms | Linux, macOS |
| Node.js | 20+ |
| License | MIT |
