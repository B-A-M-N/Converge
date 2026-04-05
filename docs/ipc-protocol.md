# IPC Protocol Specification

**Applies to:** v2.0 Native Extension Layer
**Status:** Stable
**Document:** Command plane wire format, framing, error handling, version negotiation

---

## Overview

Converge v2.0 uses Unix domain sockets for local daemon communication. The protocol is split into:

- **Command plane**: JSON-RPC 2.0 request/response
- **Event plane**: Newline-delimited event objects (unsolicited push)

Both share the same socket connection but are logically separate.

---

## Transport

- **Socket path**: Determined by daemon config; default: `<appData>/daemon.sock`
- **Permissions**: `0600` (owner read/write only)
- **Connection**: Client initiates; daemon listens
- **Platform**: Unix-like systems only (Linux, macOS, BSD). Windows not supported in v2.0.

---

## Framing

### Command Frame (JSON-RPC)

Each command message is framed as:

```
<varint length><UTF-8 JSON payload>
```

**Varint encoding:** Standard LEB128 variable-length integer (as used by Protocol Buffers). The length is the byte count of the JSON payload that follows.

**Example:**
```
\x12{"jsonrpc":"2.0","id":1,"method":"createJob","params":{...}}
```
(Length = 18 bytes = 0x12)

**Rationale:** Length-prefixed framing allows efficient parsing without delimiter scanning. Varint saves space for small messages.

### Event Frame (Newline-delimited)

Each event is a complete JSON object followed by a newline (`\n`):

```
{"event_id":123,"created_at":"2026-03-26T...","type":"run.started",...}\n
```

Newline is the delimiter. Events are not length-prefixed.

**Rationale:** Simpler for push streaming; compatible with line-oriented tools.

---

## JSON-RPC 2.0 Command Protocol

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": <number | string>,
  "method": "string",
  "params": <object>
}
```

**Fields:**
- `id`: Correlation identifier; echoed in response. Number or string. Client-generated unique per request.
- `method`: Method name (dot notation). See [Command Methods](#command-methods).
- `params`: Object containing all parameters. No positional params.

### Response Format

**Success:**
```json
{
  "jsonrpc": "2.0",
  "id": <same as request>,
  "result": <any>
}
```

**Error:**
```json
{
  "jsonrpc": "2.0",
  "id": <same as request>,
  "error": {
    "code": <number>,
    "message": "string",
    "data"?: <any>
  }
}
```

**Standard JSON-RPC error codes:**
- `-32700`: Parse error
- `-32600`: Invalid Request
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- `-32000` to `-32099`: Server error (reserved for implementation-defined)

**Converge-specific error codes (extend standard):**
- `-32001`: Daemon unavailable (during startup/shutdown)
- `-32002`: Permission denied (socket ACL, user mismatch)
- `-32003`: Validation error (input failed schema)
- `-32004`: Lease conflict (contention failure)
- `-32005`: Incompatible protocol version
- `-32006`: Resource limit exceeded
- `-32007`: Maintenance mode
- `-32008`: Global paused

---

## Version Negotiation

**Handshake sequence:**

1. Client connects to Unix socket
2. Client sends `getCapabilities` request immediately
3. Daemon responds with:
   ```json
   {
     "jsonrpc":"2.0",
     "id":1,
     "result":{
       "protocol_version": 1,
       "capabilities": ["events", "checkpoint", "bulk"]
     }
   }
   ```
4. Client checks:
   - Major version must match (breaking changes increment major)
   - Required capabilities present (e.g., client needs `events` capability for subscriptions)
5. If mismatch, client disconnects and throws `IncompatibleVersionError`
6. If compatible, client proceeds with other operations

**Capability negotiation:** Clients must not assume features beyond what daemon advertises. For example, if `bulk` missing, client must not send bulk operations.

---

## Command Methods

### Job Management

| Method | Params | Result | Actor Required |
|--------|--------|--------|----------------|
| `createJob` | `{ spec: JobSpec, actor: Actor }` | `Job` | Yes |
| `listJobs` | `{}` | `Job[]` | No |
| `getJob` | `{ jobId: string }` | `Job` | No |
| `pauseJob` | `{ jobId: string, actor: Actor }` | `null` | Yes |
| `resumeJob` | `{ jobId: string, actor: Actor }` | `null` | Yes |
| `cancelJob` | `{ jobId: string, actor: Actor }` | `null` | Yes |
| `runNow` | `{ jobId: string, actor: Actor }` | `Run` | Yes |
| `validateJobSpec` | `{ spec: JobSpec }` | `{ valid: boolean, errors?: ValidationError[] }` | No |

### Query

| Method | Params | Result | Actor Required |
|--------|--------|--------|----------------|
| `getActiveLease` | `{ jobId: string }` | `Lease \| null` | No |
| `getConvergence` | `{ runId: string }` | `{ converged: boolean, metric: string, details?: any }` | No |
| `isGloballyPaused` | `{}` | `boolean` | No |
| `getMaintenanceMode` | `{}` | `boolean` | No |
| `getCapabilities` | `{}` | `{ protocol_version: number, capabilities: string[] }` | No |

### Event Subscription

| Method | Params | Result | Notes |
|--------|--------|--------|-------|
| `subscribe` | `{ callback?: EventCallback, filters?: { jobId?, runId?, eventTypes?[] }, since?: number }` | `SubscriptionHandle` | Long-lived; events pushed on separate channel |
| `unsubscribe` | `{ handle: string }` | `null` | Cancel subscription |

**Subscription semantics:** `subscribe` returns immediately with a handle. Actual events arrive on the event plane (see below). The `since` parameter replays past events with `event_id > since`.

---

## Event Plane

### Connection Model

Clients open a single Unix socket connection used for both commands and events.

**Subscription lifecycle:**
1. Client sends `subscribe` request via command plane
2. Daemon begins pushing events for that subscription on the event channel
3. Events are newline-delimited JSON objects, **not** JSON-RPC envelopes
4. Client processes events and tracks last `event_id` as checkpoint
5. On disconnect, client reconnects and re-subscribes with `since=lastId`

### Event Object Schema

```typescript
interface Event {
  event_id: number;          // Monotonic integer, per-daemon
  created_at: string;        // ISO 8601 UTC
  type: string;              // e.g., "job.created", "run.started"
  source: "control-plane" | "scheduler" | "recovery";
  data: {                    // Event-specific payload
    jobId?: string;
    runId?: string;
    from?: string;          // for state_changed
    to?: string;            // for state_changed
    [key: string]: any;
  };
}
```

**Example:**
```json
{"event_id":456,"created_at":"2026-03-26T12:34:56.789Z","type":"state_changed","source":"control-plane","data":{"jobId":"job-123","runId":"run-456","from":"active","to":"paused"}}
```

### Delivery Guarantees

- **At-least-once**: If client disconnects, events may be re-sent after reconnect via `since` replay
- **No deduplication**: Client must handle duplicate events (e.g., by remembering last processed `event_id`)
- **Per-job ordering**: Events for the same `job_id` arrive in `event_id` order
- **No global ordering**: Events from different jobs can interleave arbitrarily
- **No server buffering**: If client cannot receive, daemon drops connection; client must reconnect and replay

---

## Error Handling

### Connection Errors

| Condition | Client Error | Recovery |
|-----------|--------------|----------|
| Socket file absent | `DaemonUnavailableError` | Retry connection with backoff; fail if persistent |
| Permission denied (EACCES) | `PermissionDeniedError` | Inform user; fix socket ACL |
| Connection refused (ECONNREFUSED) | `DaemonUnavailableError` | Retry; daemon may be starting |
| Malformed frame from daemon | `ProtocolError` | Disconnect; retry connection |

### Request Errors

| Condition | JSON-RPC Error Code | Client Behavior |
|-----------|--------------------|-----------------|
| Method not found | -32601 | Fatal: incompatible daemon version |
| Invalid params (schema fail) | -32602 | Throw `ValidationError` with details |
| Incompatible protocol version | -32005 | Throw `IncompatibleVersionError` |
| Lease conflict (runNow contention) | -32004 | Throw `LeaseConflictError`; retry logic optional |
| Global paused | -32008 | Throw `GlobalPausedError` |
| Maintenance mode | -32007 | Throw `MaintenanceModeError` |
| Internal daemon error | -32603 / -32000 | Throw `DaemonError`; may retry |

**Timeout policy:**
- Command requests: default 30s timeout (configurable)
- Event subscription: no timeout; long-lived
- Connection establishment: 5s timeout

---

## Security Model

- Unix socket file owned by daemon user; permissions `0600`
- Client must run as same user to connect
- No authentication beyond filesystem permissions
- All trust boundary validation happens at application layer (schema, sanitization)

**No network exposure:** Socket bound to filesystem only, not TCP. No external network access.

---

## TypeScript Client Implementation Guidance

Client library should provide:

```typescript
class ConvergeClient implements IConvergeClient {
  async connect(): Promise<void>;
  async createJob(spec: JobSpec, actor: Actor): Promise<Job>;
  async listJobs(): Promise<Job[]>;
  async getJob(jobId: string): Promise<Job>;
  async pauseJob(jobId: string, actor: Actor): Promise<void>;
  async resumeJob(jobId: string, actor: Actor): Promise<void>;
  async cancelJob(jobId: string, actor: Actor): Promise<void>;
  async runNow(jobId: string, actor: Actor): Promise<Run>;
  async validateJobSpec(spec: JobSpec): Promise<{valid: boolean, errors: ValidationError[]}>;
  async getActiveLease(jobId: string): Promise<Lease | null>;
  async getConvergence(runId: string): Promise<{converged: boolean, metric: string, details?: any}>;
  async isGloballyPaused(): Promise<boolean>;
  async getMaintenanceMode(): Promise<boolean>;
  async getCapabilities(): Promise<{protocol_version: number, capabilities: string[]}>;
  async subscribe(callback: (event: Event) => void, filters?: SubscribeFilters, since?: number): Promise<SubscriptionHandle>;
  async unsubscribe(handle: string): Promise<void>;
}
```

**Error hierarchy:**
- `ConvergeError` (base)
  - `DaemonUnavailableError`
  - `PermissionDeniedError`
  - `ValidationError`
  - `IncompatibleVersionError`
  - `ProtocolError`
  - `LeaseConflictError`
  - `GlobalPausedError`
  - `MaintenanceModeError`

---

## Implementation References

- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- LEB128 varint encoding: https://en.wikipedia.org/wiki/LEB128
- Event ordering: see `docs/event-protocol.md`
- Extension manifest: see `docs/extension-manifest.md`
- Design invariants: see `.planning/design-decisions.md`

---

*Document version: 1.0 — 2026-03-26*
