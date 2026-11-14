#!/usr/bin/env bash
# Uses a disposable database on the local PostgreSQL test instance.
set -euo pipefail
db="etb_revision_test_$$"
createdb "$db"
trap 'dropdb "$db"' EXIT
sql() { psql -XqAt -v ON_ERROR_STOP=1 -d "$db" "$@"; }
sql -c "create table ei_typebomb_rooms(id int primary key, items jsonb not null)"
sql -f "$(dirname "$0")/../../supabase/migrations/20261113000000_add_room_edit_version.sql"
[[ $(sql -c "insert into ei_typebomb_rooms values (1,'[]') returning edit_version") == 0 ]]
write() { sql -c "update ei_typebomb_rooms set items='[$1]' where id=1 and edit_version=0"; }
write 1 & first=$!
write 2 & second=$!
wait "$first"
wait "$second"
[[ $(sql -c "select edit_version from ei_typebomb_rooms") == 1 ]]
if sql -c "update ei_typebomb_rooms set items=null" 2>/dev/null; then exit 1; fi
latest=$(sql -c "select edit_version from ei_typebomb_rooms")
[[ $latest == 1 ]]
[[ $(sql -c "update ei_typebomb_rooms set items='[3]' where edit_version=$latest returning edit_version") == 2 ]]
