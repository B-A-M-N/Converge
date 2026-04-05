#!/usr/bin/env bash
#
# Converge bootstrap wrapper
# - Checks if daemon socket is available
# - Auto-starts daemon if not running
# - Waits for readiness with timeout
# - Forwards command to converge CLI
#
# Usage: scripts/converge-bootstrap.sh [converge arguments]

set -euo pipefail

# Configuration
SOCKET_TIMEOUT_MS=5000
DAEMON_START_TIMEOUT_MS=10000
DAEMON_CHECK_INTERVAL_MS=100

# Resolve socket path (match ConvergeClient.getDefaultSocketPath)
if [[ -n "${CONVERGE_SOCKET_PATH:-}" ]]; then
    SOCKET_PATH="$CONVERGE_SOCKET_PATH"
elif [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    SOCKET_PATH="$XDG_RUNTIME_DIR/converge.sock"
else
    UID=$(id -u 2>/dev/null || echo 1000)
    SOCKET_PATH="/tmp/converge-${UID}.sock"
fi

# Get plugin root directory (this script's parent directory's parent)
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Log function (only if DEBUG set)
log_debug() {
    if [[ "${CONVERGE_BOOTSTRAP_DEBUG:-0}" == "1" ]]; then
        echo "[converge-bootstrap] $*" >&2
    fi
}

log_info() {
    echo "[converge] $*" >&2
}

# Check if daemon socket exists and responds
daemon_ready() {
    if [[ ! -S "$SOCKET_PATH" ]]; then
        log_debug "Socket not found: $SOCKET_PATH"
        return 1
    fi

    # Quick test: try to connect with netcat or use converge doctor
    if command -v converge &>/dev/null; then
        if converge doctor >/dev/null 2>&1; then
            return 0
        fi
    fi

    return 1
}

# Start the daemon
start_daemon() {
    log_info "Starting Converge daemon..."

    # Try to start daemon in background
    if command -v converge &>/dev/null; then
        # Use converge daemon command
        nohup converge daemon >/dev/null 2>&1 &
        DAEMON_PID=$!
    else
        # Fallback: try to run directly from plugin dist
        if [[ -f "$PLUGIN_ROOT/dist/src/daemon/server.js" ]]; then
            nohup node "$PLUGIN_ROOT/dist/src/daemon/server.js" >/dev/null 2>&1 &
            DAEMON_PID=$!
        else
            log_info "Error: 'converge' command not found and no local daemon script available."
            log_info "Please install Converge globally or ensure dist/ exists."
            return 1
        fi
    fi

    # Wait for daemon to become ready
    local elapsed=0
    local interval=$((DAEMON_CHECK_INTERVAL_MS / 1000))
    while [[ $elapsed -lt $((DAEMON_START_TIMEOUT_MS / 1000)) ]]; do
        if daemon_ready; then
            log_info "Daemon started and ready."
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    log_info "Error: Daemon failed to start within ${DAEMON_START_TIMEOUT_MS}ms"
    return 1
}

# Main execution
main() {
    log_debug "Using socket: $SOCKET_PATH"
    log_debug "Plugin root: $PLUGIN_ROOT"

    # Check if daemon is already ready
    if daemon_ready; then
        log_debug "Daemon already ready."
    else
        log_info "Converge daemon not running. Starting automatically..."
        if ! start_daemon; then
            echo "ERROR: Failed to start Converge daemon." >&2
            echo "Please start it manually with: converge daemon" >&2
            exit 1
        fi
    fi

    # Execute the actual converge command
    log_debug "Executing: converge $@"
    exec converge "$@"
}

main "$@"
