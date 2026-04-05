# Converge

**Universal recurring task engine for CLI AI agents.**

Schedule work. Enforce stop conditions. Converge on outcomes.

> v2.0 Release Candidate · 785/787 tests passing · SQLite-backed · Zero cloud dependencies

---

## What It Is

`converge` is a local daemon that gives CLI AI agents — Gemini, Codex, Claude, Kimi, OpenCode — a proper recurring task primitive. Instead of agents retrying work in their own context windows or being re-prompted by hand, Converge owns the schedule, enforces bounded execution, and stops automatically when conditions are met.

**The problem it solves:** You want an agent to "check every 5 minutes until the tests pass." Today, you either stay in the loop yourself or hack something together with a shell script. Converge handles it — persistently, across restarts, with a full audit log.

---

## Quick Start

```bash
npm install -g .

# Start the daemon
converge daemon &

# Create a job: run gemini every 5 minutes until exit code 0
converge add "run tests" "*/5 * * * *" \
  --cli gemini \
  --stop '{"type":"exitCode","code":0}'

# Check on it
converge ls
converge logs <job-id>
```

---

## How It Works

```
CLI / Claude Code Plugin
        │
        ▼
  Unix Socket (IPC)
        │
        ▼
   Converge Daemon
   ├── Scheduler (cron)
   ├── Lease Manager (single-writer)
   ├── Adapter (launches the agent CLI)
   ├── Stop Condition Evaluator
   └── SQLite (persistence + event log)
```

The daemon runs independently of any agent session. It receives job definitions over a Unix domain socket, runs them on schedule via subprocess, evaluates stop conditions after each run, and writes structured logs to `~/.converge/`. If the daemon restarts, all state is recovered from SQLite.

---

## Guaranteed Properties

| Property | Detail |
|---|---|
| **Deterministic scheduling** | Cron-style intervals with stop conditions enforced at runtime, not best-effort |
| **Event sourcing** | At-least-once lifecycle events — every state transition is recorded |
| **Lease enforcement** | Atomic single-writer invariant prevents double-scheduling of the same job |
| **Safe IPC** | Unix domain socket with `0600` permissions, version negotiation, graceful failure |
| **Actor attribution** | All state transitions require explicit actor identity |
| **Crash recovery** | Orphan detection and stale-lease sweeper run on daemon startup |
| **Two usage modes** | CLI daemon (`converge daemon`) or embedded library (`import { ConvergeClient }`) |

---

## CLI Reference

### `converge add <task> <interval>`

Create a new recurring job.

```bash
converge add "run integration tests" "*/10 * * * *" \
  --cli claude \
  --stop '{"type":"exitCode","code":0}'
```

| Flag | Description |
|---|---|
| `--cli <name>` | Agent adapter to use (`claude`, `gemini`, `codex`, `kimi`, `opencode`) |
| `--stop <json>` | Stop condition as JSON (see [Stop Conditions](#stop-conditions)) |

The `<interval>` is a standard 5-field cron expression.

---

### `converge ls`

List all jobs with their current state, schedule, and next run time.

---

### `converge logs <job-id>`

View the run history for a job. Each entry includes exit code, stdout/stderr paths, start/end times, and stop condition evaluation result.

```bash
converge logs abc-123
converge logs abc-123 --json   # raw JSON output
```

---

### `converge get <job-id>`

Get the full job definition and metadata as JSON.

---

### `converge pause <job-id>`

Pause a job. The job remains in the database but the scheduler will skip it until resumed.

---

### `converge resume <job-id>`

Resume a previously paused job.

---

### `converge cancel <job-id>`

Permanently delete a job and its schedule. Run history is preserved in `~/.converge/logs/`.

---

### `converge run-now <job-id>`

Trigger an immediate out-of-schedule execution. The regular cron schedule continues afterwards.

---

### `converge doctor`

Active environment probe. Checks adapter availability, subprocess execution, database connectivity, and filesystem access.

```
[DOCTOR] Active Environment Probe
────────────────────────────────────────
Adapters:       ✓ claude: ok, gemini: ok
Subprocess:     ✓ ok
Database:       ✓ ok
Filesystem:     ✓ ok
────────────────────────────────────────
Overall:      HEALTHY
```

---

### `converge daemon`

Start the background daemon process. Listens on a Unix socket and manages all scheduled jobs.

```bash
converge daemon
```

The socket path is `$XDG_RUNTIME_DIR/converge.sock` or `/tmp/converge-<uid>.sock` as fallback. Override with `CONVERGE_SOCKET_PATH`.

---

## Stop Conditions

Stop conditions determine when a job should stop running. Pass them as JSON to `--stop`.

### Exit Code

Stop when the agent exits with a specific code.

```json
{"type": "exitCode", "code": 0}
```

### Stdout Match

Stop when the agent's stdout matches a regex pattern.

```json
{"type": "stdoutMatches", "pattern": "merged"}
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

If no stop condition is provided, the job runs indefinitely until manually cancelled.

---

## Supported Adapters

Converge can run any CLI AI agent as the executor. The adapter is responsible for launching the process, capturing output, and resuming sessions.

| Adapter | CLI | Continuation |
|---|---|---|
| `claude` | `claude` | Session resume via `--resume` |
| `gemini` | `gemini` | Subprocess per run |
| `codex` | `codex` | Subprocess per run |
| `kimi` | `kimi` | Subprocess per run |
| `opencode` | `opencode` | Subprocess per run |
| `test` / `echo` | `echo` | For testing and development |

The `claude` adapter supports session continuation — subsequent runs resume the previous conversation rather than starting fresh.

---

## Data Storage

All data is stored locally in `~/.converge/`:

```
~/.converge/
├── converge.db        # SQLite database (jobs, runs, events, leases)
├── daemon.log         # Daemon process log
└── logs/
    └── <job-id>/
        ├── run-001-stdout.log
        ├── run-001-stderr.log
        └── ...
```

No data leaves your machine.

---

## Daemon Management

### Manual (development)

```bash
converge daemon
```

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
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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

Converge ships a native Claude Code plugin that gives Claude the ability to create and manage recurring jobs directly from a conversation.

### How It Works

The plugin registers two surface areas with Claude Code:

- **Skill** (`skills/converge/SKILL.md`) — Teaches Claude when and how to use Converge. Activates automatically when the user asks to monitor, retry, poll, or schedule work. Claude will ask for any missing details (interval, stop condition) before creating a job.
- **Commands** (`commands/converge-*.md`) — Slash commands that invoke the `converge` CLI via Bash. Available in any Claude Code session once the plugin is installed.

### Installation

```bash
# Install the plugin from the repo root
claude plugin install /path/to/converge

# Reload without restarting
/reload-plugins
```

Verify:

```bash
claude plugin list   # should show converge-loop
```

### Prerequisites

The `converge` CLI must be installed and available on your `PATH` before using the plugin:

```bash
converge --version   # should return a version string
converge doctor      # should report HEALTHY
```

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

The daemon must be running for these commands to work. If `daemon_autostart` is enabled (default), the plugin will attempt to start it automatically.

### Configuration

Create `.claude/converge-loop.local.md` at your project root to configure plugin behavior:

```yaml
---
enabled: true
daemon_autostart: true
startup_timeout_ms: 10000
---
```

Copy `.claude/converge-loop.local.md.example` as a starting point. Restart Claude Code after changing settings.

| Field | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch to enable/disable the plugin |
| `daemon_autostart` | `true` | Auto-start the daemon if not running when a command is invoked |
| `startup_timeout_ms` | `10000` | Max time (ms) to wait for daemon startup |

### Plugin Structure

```
converge/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── commands/
│   ├── converge.md              # /converge — command index
│   ├── converge-add.md          # /converge-add
│   ├── converge-ls.md           # /converge-ls
│   ├── converge-status.md       # /converge-status
│   ├── converge-pause.md        # /converge-pause
│   ├── converge-resume.md       # /converge-resume
│   ├── converge-cancel.md       # /converge-cancel
│   ├── converge-run-now.md      # /converge-run-now
│   ├── converge-logs.md         # /converge-logs
│   └── converge-doctor.md       # /converge-doctor
└── skills/
    └── converge/
        └── SKILL.md             # Auto-activating skill
```

---

## Troubleshooting

### Commands not appearing in Claude Code

1. Confirm the plugin is installed: `claude plugin list` should show `converge-loop`
2. Run `/reload-plugins` in Claude Code
3. If that fails, restart Claude Code — plugins load on session start
4. Verify `commands/` exists at the plugin root and contains `.md` files
5. Check `.claude-plugin/plugin.json` is valid JSON

### Daemon fails to start

```bash
# Check what socket path is expected
echo ${CONVERGE_SOCKET_PATH:-/tmp/converge-$(id -u).sock}

# Check if the socket already exists (daemon may already be running)
ls -la /tmp/converge-$(id -u).sock

# Try starting manually with verbose output
converge daemon

# Check the daemon log
tail -f ~/.converge/daemon.log
```

### Jobs not running

```bash
converge doctor          # verify all systems healthy
converge ls              # check job state (paused? cancelled?)
converge logs <job-id>   # check last run output and exit code
```

### Adapter not found

```bash
converge doctor   # lists adapter availability under "Adapters"
which claude      # verify the CLI is on your PATH
```

---

## Status

| Property | Value |
|---|---|
| Version | v2.0 Release Candidate |
| Commit | `e07b298` |
| Tests | 785/787 passing |
| Skipped | 2 IPC protocol edge cases (covered by unit tests) |
| Audit | `PHASE-32-AUDIT.md` — VALID |
| Verdict | `PHASE-32-VERDICT.yaml` — RELEASE_CANDIDATE |
