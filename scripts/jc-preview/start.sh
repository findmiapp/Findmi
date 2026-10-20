#!/usr/bin/env bash
# JC local preview — a throwaway, fully local Supabase-compatible API so
# the real Findmi pages can be reviewed as JerseyCity.guide with populated
# Jersey City content. Nothing here talks to any Supabase project:
#
#   Postgres (temp cluster)  ← schema.sql  (Production public schema, read-only snapshot)
#                            ← reference.sql (markets/areas/categories/editorial config, copied read-only)
#                            ← fixture.sql  (fictional Jersey City content)
#   PostgREST  :54330  (anon / service_role, local JWT secret)
#   proxy.mjs  :54321  (/rest/v1 → PostgREST, /auth/v1 → no session)
#
# Requires: PostgreSQL 16 server binaries (initdb/pg_ctl/psql), curl, node.
# Usage:  scripts/jc-preview/start.sh        (Ctrl-C stops everything)
# Then, in another shell, build/run the app against it — see README.md.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${JC_PREVIEW_DIR:-${TMPDIR:-/tmp}/jc-preview}"
PG_PORT="${PREVIEW_PG_PORT:-54329}"
PGRST_PORT="${PREVIEW_PGRST_PORT:-54330}"
API_PORT="${PREVIEW_API_PORT:-54321}"
SECRET="jc-local-preview-secret-not-for-any-real-project-0001"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
PGRST_VERSION="v12.2.3"

mkdir -p "$WORK"
DATA="$WORK/pgdata-$(date +%s)"

# Postgres refuses to run as root; use the postgres user when we are root.
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

mkdir -p "$DATA"
[ "$(id -u)" = "0" ] && chown postgres "$DATA" && chmod 755 "$WORK"
as_pg "$PG_BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
as_pg "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PG_PORT -k $DATA -c listen_addresses=127.0.0.1" -l "$DATA/server.log" start >/dev/null
trap 'as_pg "$PG_BIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true; kill 0 2>/dev/null || true' EXIT

PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database preview"
for f in schema.sql reference.sql fixture.sql; do
  echo "loading $f"
  "${PSQL[@]}" -d preview -f "$HERE/$f"
done

# PostgREST (downloaded once into the work dir).
PGRST="$WORK/postgrest"
if [ ! -x "$PGRST" ]; then
  case "$(uname -s)" in
    Linux) asset="postgrest-$PGRST_VERSION-linux-static-x64.tar.xz" ;;
    Darwin) asset="postgrest-$PGRST_VERSION-macos-x64.tar.xz" ;;
    *) echo "Unsupported OS for the PostgREST download; install postgrest and set PATH." >&2; exit 1 ;;
  esac
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/$asset" | tar -xJ -C "$WORK"
fi
cat > "$WORK/postgrest.conf" <<EOF
db-uri = "postgres://authenticator:preview@127.0.0.1:$PG_PORT/preview"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
EOF
"$PGRST" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
PREVIEW_API_PORT="$API_PORT" PREVIEW_PGRST_PORT="$PGRST_PORT" node "$HERE/proxy.mjs" &

cat <<EOF

JC local preview API is up on http://localhost:$API_PORT (Ctrl-C to stop).
Build and run the app against it (another shell, repo root):

  SITE=jc \\
  NEXT_PUBLIC_SUPABASE_URL=http://localhost:$API_PORT \\
  NEXT_PUBLIC_SUPABASE_ANON_KEY=$(cat "$HERE/keys/anon.jwt") \\
  SUPABASE_SERVICE_ROLE_KEY=$(cat "$HERE/keys/service_role.jwt") \\
  npm run build && <same env> npm start

(The two keys are signed with a local-only secret and are useless
against any real Supabase project.)
EOF
wait
