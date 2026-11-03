#!/usr/bin/env bash
# Proves the backup works: saves the local database, restores it into a scratch database and checks that EVERY table
# (rows, contents, grants), every function and every sequence is the same. Also checks the encryption and the refusals.
# Needs the local stack up (npm run local:up) and no writes to the source while it runs (stop the demo servers if the
# comparison ever differs). Reads the source database; writes only the scratch database
# "salvionix_restore_check", which it drops at the end. Usage: scripts/test-db-backup.sh [source-database]
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
source_db="${1:-${PGDATABASE:-salvionix}}"
scratch="salvionix_restore_check"
PG_USER="${PG_USER:-postgres}"
if [ -z "${PG_RUN+x}" ]; then
  PG_RUN="docker compose -f $root/infra/local/docker-compose.yml --env-file $root/infra/local/.env exec -T db"
fi
export PG_RUN PG_USER

work="$(mktemp -d)"
export BACKUP_PASSPHRASE_FILE="$work/passphrase"
export BACKUP_DIR="$work/backups"
# A throwaway passphrase, written to a temporary file and never printed.
openssl rand -hex 32 > "$BACKUP_PASSPHRASE_FILE"

passed=0
failed=0
check() { # check <description> <command...>
  local label="$1"; shift
  if "$@" > "$work/last.out" 2>&1; then
    passed=$((passed + 1)); echo "  ok   $label"
  else
    failed=$((failed + 1)); echo "  FAIL $label"; sed 's/^/       /' "$work/last.out" | head -8
  fi
}
psql_in() { $PG_RUN psql -U "$PG_USER" -v ON_ERROR_STOP=1 -At "$@"; }
db_exists() { [ -n "$(psql_in -d postgres -c "select 1 from pg_database where datname = '$1'" | tr -d '\r')" ]; }
drop_scratch() { psql_in -d postgres -c "drop database if exists $scratch with (force)" > /dev/null 2>&1; }
cleanup() { drop_scratch; rm -rf "$work"; }
trap cleanup EXIT

# One line per table (rows, a hash of the contents and the grants), per function (a hash of its text) and per
# sequence (where it stands). A grant list that is empty and one that spells out the owner's own default rights are the
# same permissions, so both are written the same way. Two databases with the same output hold the same data and the same permissions.
fingerprint() {
  psql_in -d "$1" <<'SQL' | tr -d '\r'
select 'table ' || n.nspname || '.' || c.relname || ' ' ||
  (xpath('/row/c/text()', query_to_xml(format(
    'select count(*) || '':'' || coalesce(md5(string_agg(t::text, ''|'' order by t::text)), '''') as c from %I.%I t',
    n.nspname, c.relname), false, true, '')))[1]::text ||
  ' acl=' || coalesce(c.relacl, acldefault('r', c.relowner))::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
union all
select 'function ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(p.proacl, acldefault('f', p.proowner))::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all
select 'sequence ' || schemaname || '.' || sequencename || ' ' || coalesce(last_value::text, 'unused') from pg_sequences
order by 1;
SQL
}

echo "Source database: $source_db · scratch database: $scratch"
db_exists "$source_db" || { echo "no database $source_db: is the local stack up?"; exit 2; }
drop_scratch

echo "1. Backup"
check "the backup runs and writes one encrypted file" env PGDATABASE="$source_db" bash "$here/db-backup.sh"
backup="$(ls -1 "$BACKUP_DIR"/salvionix-*.tar.gpg 2>/dev/null | head -1)"
check "the file has a checksum next to it" test -s "$backup.sha256"
check "the file shows no trace of the data (no PGDMP header, no table names)" bash -c '! grep -aqE "PGDMP|core\.documents|CREATE TABLE" "$1"' _ "$backup"

echo "2. Restore and compare"
fingerprint "$source_db" > "$work/source.txt"
check "the source has data to compare ($(wc -l < "$work/source.txt") objects)" test "$(wc -l < "$work/source.txt")" -gt 50
check "restore into a new database succeeds" bash "$here/db-restore.sh" "$backup" --target "$scratch" --documents-dir "$work/docs-restored"
fingerprint "$scratch" > "$work/restored.txt"
check "every table, function, grant and sequence is identical" diff "$work/source.txt" "$work/restored.txt"
docs_source="${DOCUMENTS_DIR:-$root/core-api/.data/documents}"
if [ -d "$docs_source" ] && ls "$docs_source"/*.pdf > /dev/null 2>&1; then
  check "every PDF came back, byte for byte" diff <(cd "$docs_source" && sha256sum -- *.pdf | sort -k2) <(cd "$work/docs-restored" && sha256sum -- *.pdf | sort -k2)
else
  echo "  --   no PDF files in $docs_source: the PDF copy was not compared"
fi
check "restoring on top of an existing database is refused" bash -c '! bash "$1" "$2" --target "$3"' _ "$here/db-restore.sh" "$backup" "$scratch"
# The comparison must be able to fail: change one row and one grant in the copy and it has to notice both.
psql_in -d "$scratch" -c "update core.messages set body = body || 'x' where id = (select min(id) from core.messages)" > /dev/null
fingerprint "$scratch" > "$work/changed-row.txt"
check "the comparison notices one changed row" bash -c '! diff -q "$1" "$2"' _ "$work/source.txt" "$work/changed-row.txt"
psql_in -d "$scratch" -c "update core.messages set body = left(body, length(body) - 1) where id = (select min(id) from core.messages)" > /dev/null
psql_in -d "$scratch" -c "grant select on core.messages to public" > /dev/null
fingerprint "$scratch" > "$work/changed-grant.txt"
check "the comparison notices one extra grant" bash -c '! diff -q "$1" "$2"' _ "$work/source.txt" "$work/changed-grant.txt"
drop_scratch

echo "3. Refusals leave nothing behind"
printf 'not the passphrase at all, but long enough' > "$work/wrong"
check "a wrong passphrase is refused and no database is created" bash -c '! BACKUP_PASSPHRASE_FILE="$1" bash "$2" "$3" --target "$4"' _ "$work/wrong" "$here/db-restore.sh" "$backup" "$scratch"
if db_exists "$scratch"; then failed=$((failed + 1)); echo "  FAIL a refused restore created the database"; else passed=$((passed + 1)); echo "  ok   a refused restore created no database"; fi

size="$(wc -c < "$backup")"
cp "$backup" "$work/tampered.tar.gpg"
printf '\xff' | dd of="$work/tampered.tar.gpg" bs=1 seek=$((size / 2)) conv=notrunc 2> /dev/null
check "a file with one changed byte is refused" bash -c '! bash "$1" "$2" --target "$3"' _ "$here/db-restore.sh" "$work/tampered.tar.gpg" "$scratch"
head -c $((size / 2)) "$backup" > "$work/truncated.tar.gpg"
check "a truncated file is refused" bash -c '! bash "$1" "$2" --target "$3"' _ "$here/db-restore.sh" "$work/truncated.tar.gpg" "$scratch"
if db_exists "$scratch"; then failed=$((failed + 1)); echo "  FAIL a damaged file created the database"; else passed=$((passed + 1)); echo "  ok   a damaged file created no database"; fi
check "a backup without its passphrase file is refused" bash -c '! env -u BACKUP_PASSPHRASE_FILE bash "$1" 2>&1' _ "$here/db-backup.sh"

echo "4. Retention"
for _ in 1 2 3; do sleep 1; PGDATABASE="$source_db" BACKUP_KEEP=2 bash "$here/db-backup.sh" > /dev/null 2>&1; done
check "only the newest 2 backups are kept (with their checksums)" test "$(ls -1 "$BACKUP_DIR"/salvionix-*.tar.gpg | wc -l)" -eq 2 -a "$(ls -1 "$BACKUP_DIR"/*.sha256 | wc -l)" -eq 2

echo
echo "$passed correct, $failed with a problem"
[ "$failed" -eq 0 ]
