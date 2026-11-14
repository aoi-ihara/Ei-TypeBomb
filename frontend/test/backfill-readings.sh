#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
db="etb_backfill_test_$$"
createdb "$db"
trap 'dropdb "$db"' EXIT
sql() { psql -XqAt -v ON_ERROR_STOP=1 -d "$db" "$@"; }
sql -c "create table ei_typebomb_rooms(id uuid primary key, items jsonb not null)"
sql -f ../supabase/migrations/20261113000000_add_room_edit_version.sql
sql <<'SQL'
insert into ei_typebomb_rooms
select gen_random_uuid(), '[{"id":"1","type":"typed_recall","prompt":"問","answer":"凝析"}]'::jsonb
from generate_series(1,101);
SQL
run() { PGHOST="${PGHOST:-/tmp}" DATABASE_URL="postgresql:///$db" ./node_modules/.bin/tsx scripts/backfill-readings.mts "$1"; }
run --dry-run
[[ $(sql -c "select sum(edit_version) from ei_typebomb_rooms") == 0 ]]
run --apply
run --apply
[[ $(sql -c "select count(*) from ei_typebomb_rooms where edit_version=1 and items->0->'reading_version'='2' and items->0->'readings'->>0='ぎょうせき'") == 101 ]]
