#!/bin/sh
set -eu

SOCKET_PATH="/var/run/docker.sock"

if [ -S "$SOCKET_PATH" ]; then
  SOCKET_GID="$(stat -c '%g' "$SOCKET_PATH")"
  SOCKET_GROUP="$(awk -F: -v gid="$SOCKET_GID" '$3 == gid { print $1; exit }' /etc/group)"

  if [ -z "$SOCKET_GROUP" ]; then
    SOCKET_GROUP="docker-socket-$SOCKET_GID"
    addgroup -S -g "$SOCKET_GID" "$SOCKET_GROUP" >/dev/null 2>&1 || true
  fi

  addgroup node "$SOCKET_GROUP" >/dev/null 2>&1 || true
fi

exec su-exec node "$@"
