# Converge

**A persistent recurring task engine for CLI AI agents.**

Schedule work. Enforce stop conditions. Converge on outcomes.

> v2.0 · SQLite-backed · Zero cloud dependencies · Auto-launching daemon

---

## Why I Built This

I work almost exclusively through CLI agents — Claude, Gemini, Codex, and others. When I discovered the `/loop` command in Claude Code, my immediate reaction was: *this should exist for every agent, not just one.* At the same time, I kept running into the limits of what a session-bound loop can actually do. It dies when the session ends. It can't be triggered by another agent. There's no history, no stop conditions, no way to pause or recover.

Converge is the answer to both questions at once: a universal recurring task primitive that any CLI agent can use, built to be more capable than a simple loop from the ground up.

---

## What It Is

`converge` is a local daemon that gives any CLI AI agent — Claude, Gemini, Codex, Kimi, OpenCode — a proper recurring task primitive. You define a job once. The daemon owns the schedule, runs the agent on each tick, evaluates stop conditions, and maintains a full audit log — persistently, across restarts, independent of any active session.

**The problem it solves:** You want an agent to "check every 5 minutes until the tests pass." Today, you either babysit it yourself or hack something together with a shell script. Converge handles it cleanly, with structured logs and automatic stop conditions.

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

## How It Works

```
CLI command  /  Claude Code Plugin
              │
              ▼
       Unix Socket (IPC)
              │
              ▼
       Converge Daemon
       ├── Scheduler (interval-based)
       ├── Lease Manager (single-writer)
       ├── Adapter (launches the agent CLI)
       ├── Stop Condition Evaluator
       └── SQLite (persistence + event log)
```

The daemon runs independently of any agent session. Jobs are defined over a Unix domain socket, executed on schedule via subprocess, and evaluated against stop conditions after each run. All state is written to `~/.converge/`. If the daemon restarts, all jobs and run history are recovered from SQLite.

---

## Guarantees

| Property | Detail |
|---|---|
| **Persistent scheduling** | Jobs survive session ends, restarts, and crashes |
| **Autolaunch** | Daemon starts automatically on first CLI use — no manual setup required |
| **Event sourcing** | Every state transition is recorded with actor identity and timestamp |
| **Lease enforcement** | Atomic single-writer lock prevents a job from running concurrently with itself |
| **Safe IPC** | Unix domain socket with `0600` permissions, framing protocol, and version negotiation |
| **Crash recovery** | Orphan detection and stale-lease sweeper run on daemon startup |
| **No cloud** | All data stays on your machine in `~/.converge/` |

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

Permanently remove a job from the schedule. Run history is preserved in `~/.converge/`.

---

### `converge run-now <job-id>`

Trigger an immediate out-of-schedule execution. The regular schedule continues afterwards.

---

### `converge explain <job-id>`

Show a human-readable explanation of a job's current state, configuration, and recent run history.

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

### Exit Code

```json
{"type": "exitCode", "code": 0}
```

### Output Match

Stop when the agent's stdout matches a regex pattern.

```json
{"type": "stdoutMatches", "pattern": "all tests passed"}
```

### Compound

Combine conditions with `all` (AND) or `any` (OR).

```json
{
  "type": "compound",
  "operator": "any",
  "conditions": [
    {"type": "exitCode", "code": 0},
    {"type": "stdoutMatches", "pattern": "DONE"}
  ]
}
```

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

All data is stored locally:

```
~/.converge/
├── converge.db        # SQLite — jobs, runs, leases, events
├── converge.sock      # Unix socket (created when daemon is running)
├── daemon.log         # Daemon stdout/stderr
└── logs/
    └── <job-id>/
        ├── <run-id>.log
        └── ...
```

---

## Daemon Management

The daemon launches automatically on first use. For production or always-on setups, you can run it under a process supervisor.

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

## Status

| | |
|---|---|
| Version | 2.0.0 |
| Tests | 785 / 787 passing |
| Storage | SQLite, local only |
| Platforms | Linux, macOS |
| Node.js | 20+ |
