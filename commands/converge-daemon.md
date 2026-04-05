---
description: Start the background daemon process
tools: ["Bash"]
---

Use the Bash tool to run:

```bash
converge daemon
```

This starts the Converge daemon in the foreground. The daemon manages all scheduled jobs, handles IPC, and persists state to `~/.converge/`. Use Ctrl+C to stop it.

For production use, consider running it as a systemd service or launchd agent (see README for examples).
