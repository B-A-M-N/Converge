---
description: Delete a job (soft delete, preserve runs)
argument-hint: <job-id>
tools: ["Bash"]
---

Use the Bash tool to run:

```bash
converge rm "$JOB_ID"
```

This soft-deletes the job while preserving its run history for audit purposes.
