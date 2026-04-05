---
description: Create a new recurring task
argument-hint: --every <interval> --task "<task>" [--cli <cli>] [--stop <json>]
allowed-tools: ["mcp__plugin:serena:serena__execute_shell_command"]
---

Use the MCP tool `converge` -> `loop_create` with the extracted arguments:
- `interval`: the interval from `--every` (e.g., "5m", "1h")
- `task`: the task/command from `--task`
- `cli`: optional CLI name from `--cli`
- `stopCondition`: optional from `--stop`

Display the result in a user-friendly format.
