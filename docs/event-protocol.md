# Event Protocol Specification

**Applies to:** v2.0 Event Subscription System
**Status:** Stable
**Document:** Event schema, ordering guarantees, replay semantics

---

## Event Sources

Events are emitted by the daemon's ControlPlane and job scheduler. Sources:

- **ControlPlane**: Job lifecycle (created, paused, resumed, cancelled), state changes
- **Scheduler**: Run lifecycle (started, finished, converged, stop condition triggered)
- **Recovery**: Orphan handling, lease recovery decisions

---

## Event Schema

### Base Structure

All events share these required fields:

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `number` | Monotonic integer, increasing per-daemon instance (not globally unique across restarts) |
| `created_at` | `string` (ISO 8601) | Timestamp when event was recorded (UTC) |
| `type` | `string` | Event type identifier (kebab-case) |
| `source` | `"control-plane"` \| `"scheduler"` \| `"recovery"` | Subsystem that produced the event |
| `data` | `object` | Event-specific payload (schema varies by type) |

### Standard Event Types

#### Job Events

**`job.created`**
```typescript
data: {
  jobId: string;
  name: string;
  cli: string;
  spec: JobSpec; // normalized, sanitized
}
```

**`job.paused`**
```typescript
data: {
  jobId: string;
  actor: Actor; // who paused
}
```

**`job.resumed`**
```typescript
data: {
  jobId: string;
  actor: Actor;
}
```

**`job.cancelled`**
```typescript
data: {
  jobId: string;
  actor: Actor;
  reason?: string;
}
```

**`job.failed`**
```typescript
data: {
  jobId: string;
  runId: string;
  error: string; // failure reason
}
```

**`job.completed`**
```typescript
data: {
  jobId: string;
  finalRunId: string;
  convergence: "converged" | " stopped" | "failed";
}
```

#### Run Events

**`run.started`**
```typescript
data: {
  jobId: string;
  runId: string;
  pid: number;
  iteration: number;
  startedAt: string; // ISO
}
```

**`run.finished`**
```typescript
data: {
  jobId: string;
  runId: string;
  exitCode: number;
  signal?: string;
  finishedAt: string; // ISO
  durationMs: number;
  provenanceSummary?: RunProvenance; // simplified provenance
}
```

**`run.converged`**
```typescript
data: {
  jobId: string;
  runId: string;
  metric: "stdout_hash" | "exit_code" | "custom";
  details: { [key: string]: any };
  convergedAt: string; // ISO
}
```

**`stop_condition.triggered`**
```typescript
data: {
  jobId: string;
  runId: string;
  condition: StopCondition; // which condition matched
  matchedValue: any; // actual value that triggered
}
```

#### State Change Events

**`state_changed`** (generic job state transition)
```typescript
data: {
  jobId: string;
  runId?: string; // optional; for job-level states may omit
  from: string; // previous state enum value
  to: string;   // new state enum value
  actor?: Actor; // if user-initiated
}
```

**Example:** `from: "active", to: "paused"` when `pauseJob` called.

---

## Ordering Guarantees

**Strict per-job/per-run ordering:** Events that share the same `job_id` (or `run_id` when `run_id` present) will have monotonically increasing `event_id`s that reflect true chronological order.

**No global ordering guarantee:** Events from different jobs/runs may be observed in any relative order. Clients must not assume system-wide ordering.

**Checkpoint numbering:** Clients use `event_id` as checkpoint. To resume after disconnect, request `subscribe({ since: lastEventId })`. Daemon returns all events with `event_id > lastEventId` in ascending order.

---

## Replay and Recovery

### Subscribe Request

```typescript
{
  "jsonrpc":"2.0",
  "id": 42,
  "method": "subscribe",
  "params": {
    "filters"?: { "jobId"?, "runId"?, "eventTypes"?[] },
    "since"?: number  // optional checkpoint; if omitted, starts from now
  }
}
```

**Response:**
```json
{
  "jsonrpc":"2.0",
  "id": 42,
  "result": { "handle": "sub-123" }
}
```

### Replay Semantics

1. Client connects and sends `subscribe` with `since=lastCheckpoint`
2. Daemon queries `events` table for `event_id > since` (and matching filters)
3. Daemon streams matching events as newline-delimited JSON over the event channel
4. After replay completes, daemon pushes new events as they occur
5. Client processes events in order, updating `lastCheckpoint = event.event_id` after each
6. If client disconnects, it must reconnect and repeat from step 1 with latest checkpoint

**Note:** If `since` is beyond the oldest retained event, daemon returns empty replay then continues with new events. No error.

---

## Delivery Guarantees

- **At-least-once**: Events are not removed from the queue until client acknowledges by moving checkpoint forward. If client disconnects before processing, events will be re-sent on reconnect.
- **No deduplication**: Same event may be delivered twice if client re-subscribes with overlapping checkpoint. Client must deduplicate using `event_id`.
- **No server-side buffering for slow consumers**: If client cannot keep up, daemon may close connection. Client must handle this and replay from last checkpoint. Server does not retain unbounded event backlog.
- **Durability**: Events are written to the database in the same transaction as the state change they describe. If state change rolls back, no event is emitted.

---

## Event Plane Channel

After `subscribe` request returns a `handle`, daemon begins pushing events on the same socket but **outside** the JSON-RPC request/response framing.

**Format:** Each event is a complete JSON object followed by `\n` (newline). No length prefix.

**Example stream:**
```
{"event_id":100,"created_at":"2026-03-26T...","type":"job.created",...}
{"event_id":101,"created_at":"2026-03-26T...","type":"run.started",...}
```

**Subscription termination:**
- Client sends `unsubscribe(handle)` to cancel
- Daemon closes connection on graceful shutdown
- Daemon may close connection if client falls too far behind (backpressure)
- Client must treat connection close as signal to reconnect with current checkpoint

---

## Filtering

**MVP (Phase 27):** No server-side filtering. Client receives all events and filters locally.

**Future (optional):** Server may support `filters` param in `subscribe`:
- `jobId`: only events for this job
- `runId`: only events for this run
- `eventTypes`: whitelist of event types

If server does not support filtering (capability not advertised), it ignores `filters` and client filters locally.

---

## Backpressure and Flow Control

**No server-side buffering:**

- Daemon writes event to socket; if socket buffer full, write fails
- On write failure, daemon closes connection immediately
- Client detects disconnect, reconnects, re-subscribes with last checkpoint
- This ensures server cannot OOM from slow consumers

**Client-side rate limiting:**

- Clients should process events promptly; if processing is slow, consider:
  - Batching checkpoint updates
  - Dropping non-critical events (but must still replay to maintain ordering)
  - Scaling horizontally (multiple daemon instances not in v2.0 scope)

---

## Event Schema Evolution

**Allowed changes (backward compatible):**
- Add new optional fields to `data` objects
- Add new event types
- Extend `data` with additional properties (clients ignore unknown)

**Forbidden changes (breaking):**
- Remove or rename existing fields
- Change field types
- Change `event_id` semantics (must remain monotonic per-daemon)

**Versioning:** Protocol version handles breaking changes. Event schema evolves within version.

---

## Checkpoint Management

**Client responsibility:**

- After successfully processing an event, client must persist `event_id` as checkpoint
- On reconnect, include `since: lastCheckpoint` to replay missed events
- Checkpoint must be persisted durably (e.g., to local file or DB) to survive client restart

**Server role:**

- Does not store per-client checkpoints
- Replays from database query `WHERE event_id > since`

**Checkpoint gaps:**

- If client checkpoint is lost (e.g., client crash), replay will re-deliver some events (at-least-once)
- Clients must handle duplicates via `event_id` tracking (remember last processed)

---

## Implementation Notes for Phase 27

1. **Event table schema:** Already exists from v1.0. Ensure `event_id` is indexed and monotonic.
2. **Emission order:** All events emitted within the same transaction that caused them. `event_id` assigned by auto-increment.
3. **Replay query:** `SELECT * FROM events WHERE event_id > $since ORDER BY event_id ASC`. Add filters if implemented.
4. **Subscription storage:** In-memory `Map<handle, Subscription>` containing callback and filters. On daemon restart, all subscriptions lost (acceptable).
5. **Connection tracking:** Each socket connection has a unique connection ID. Subscriptions are tied to connection; on disconnect, cleanup all subscriptions for that connection.
6. **Metrics:** Track `subscriptions_active`, `events_pushed`, `reconnects` for observability.

---

## Verification Tests

Phase 27 must verify:

- [ ] Subscribe + receive events matching filters
- [ ] Auto-cleanup on disconnect (no zombie subscriptions)
- [ ] Reconnect with checkpoint replays exactly missed events (no gaps, no duplicates beyond expected)
- [ ] Per-job ordering preserved even with concurrent jobs
- [ ] Server closes connection on backpressure (simulated slow client)
- [ ] Event `event_id` and `created_at` present and correctly typed
- [ ] Malformed unsubscribe requests handled gracefully
- [?] Optional: server-side filtering (if implemented)

---

## References

- IPC protocol: `docs/ipc-protocol.md`
- Design invariants: `.planning/design-decisions.md`
- Event table schema: `src/repositories/EventRepository.ts` (v1.0)

---

*Document version: 1.0 — 2026-03-26*
