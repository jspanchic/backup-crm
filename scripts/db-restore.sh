#!/usr/bin/env bash
# Restores a backup made by scripts/db-backup.sh into a database. Usage:
#   scripts/db-restore.sh <backup.tar.gpg> [--target <database>] [--replace] [--documents-dir <folder>]
#
# The target defaults to <PGDATABASE>_restored, a NEW database, so a restore can never overwrite the live one by
# accident. To restore as the live database after a disaster, name it: --target salvionix. If the target already
# exists the script stops, unless --replace is given (then it is dropped first).
# The roles must exist before: run `npm run db:bootstrap` (it creates them from the .env of the machine).
# PDFs are copied only if --documents-dir is given (files that already exist there are not touched).
# Same environment as db-backup.sh: BACKUP_PASSPHRASE_FILE, PG_USER, PG_RUN, PGDATABASE.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

fail() { echo "db-restore: $*" >&2; exit 1; }

backup=""
target=""
replace=0
documents_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) target="${2:-}"; shift 2 ;;
    --replace) replace=1; shift ;;
    --documents-dir) documents_dir="${2:-}"; shift 2 ;;
    -*) fail "unknown option $1" ;;
    *) [ -z "$backup" ] || fail "only one backup file"; backup="$1"; shift ;;
  esac
done

[ -n "$backup" ] || fail "usage: db-restore.sh <backup.tar.gpg> [--target <database>] [--replace] [--documents-dir <folder>]"
[ -f "$backup" ] || fail "no such file: $backup"
[ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && [ -s "$BACKUP_PASSPHRASE_FILE" ] || fail "set BACKUP_PASSPHRASE_FILE to the file that holds the passphrase"

PGDATABASE="${PGDATABASE:-salvionix}"
PG_USER="${PG_USER:-postgres}"
target="${target:-${PGDATABASE}_restored}"
if [ -z "${PG_RUN+x}" ]; then
  PG_RUN="docker compose -f $root/infra/local/docker-compose.yml --env-file $root/infra/local/.env exec -T db"
fi
case "$target" in [a-z]*) ;; *) fail "invalid target name" ;; esac
case "$target" in *[!a-z0-9_]*) fail "invalid target name" ;; esac
[ "${#target}" -le 63 ] || fail "invalid target name"

# The checksum next to the file, if it travelled with it.
if [ -f "$backup.sha256" ]; then
  (cd "$(dirname "$backup")" && sha256sum --status -c "$(basename "$backup").sha256") || fail "the file does not match its .sha256: it is damaged or was changed"
fi

stage="$(mktemp -d)"
created=0
cleanup() {
  status=$?
  rm -rf "$stage"
  # A restore that stopped half way must not leave a database that looks complete.
  if [ "$status" -ne 0 ] && [ "$created" -eq 1 ]; then
    # shellcheck disable=SC2086
    $PG_RUN psql -U "$PG_USER" -d postgres -c "drop database if exists \"$target\" with (force)" > /dev/null 2>&1 || true
    echo "db-restore: the half-restored database \"$target\" was removed" >&2
  fi
}
trap cleanup EXIT

# 1. Decrypt and unpack into a private temporary folder. Nothing touches a database until this succeeds.
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt "$backup" \
  | tar -xf - -C "$stage" || fail "could not decrypt the backup (wrong passphrase, or the file was changed)"
(cd "$stage" && sha256sum --quiet -c SHA256SUMS) || fail "a file inside the backup does not match its checksum"

# 2. A new database owned by core_owner, and the data.
# shellcheck disable=SC2086
exists="$($PG_RUN psql -U "$PG_USER" -d postgres -Atc "select 1 from pg_database where datname = '$target'" | tr -d '\r')"
if [ -n "$exists" ]; then
  [ "$replace" -eq 1 ] || fail "the database \"$target\" already exists; choose another --target or add --replace"
  # shellcheck disable=SC2086
  $PG_RUN psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c "drop database \"$target\" with (force)" > /dev/null
fi
# shellcheck disable=SC2086
$PG_RUN psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c "create database \"$target\" owner core_owner" > /dev/null \
  || fail "could not create the database (do the roles exist? run npm run db:bootstrap)"
created=1
# shellcheck disable=SC2086
$PG_RUN pg_restore -U "$PG_USER" -d "$target" --exit-on-error < "$stage/db.dump" || fail "pg_restore failed"

# 3. The PDFs, only where asked.
copied=0
if [ -n "$documents_dir" ]; then
  mkdir -p "$documents_dir"
  for file in "$stage"/documents/*.pdf; do
    [ -e "$file" ] || continue
    [ -e "$documents_dir/$(basename "$file")" ] || { cp -p "$file" "$documents_dir/"; copied=$((copied + 1)); }
  done
fi

created=0
echo "db-restore: database \"$target\" restored from $(basename "$backup") ($(grep '^created_at_utc=' "$stage/INFO" | cut -d= -f2)); $copied PDF files copied"
