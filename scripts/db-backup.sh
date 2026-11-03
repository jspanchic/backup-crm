#!/usr/bin/env bash
# Encrypted backup of the Salvionix database and of the private folder of PDFs (CRM-T12).
# One file out: salvionix-<UTC time>.tar.gpg, plus its .sha256. Restore with scripts/db-restore.sh.
# Full guide: docs/COPIAS_BD.md
#
# Needs: bash, gpg, tar, sha256sum, and a way to reach the Postgres client tools (see PG_RUN).
#
# Environment
#   BACKUP_PASSPHRASE_FILE  required. A file that holds the passphrase. Keep it OUT of the repository and off the
#                           server's backup folder: whoever has the file and the backup can read everything.
#   BACKUP_DIR              where backups go (default: <repo>/backups, ignored by git)
#   BACKUP_KEEP             how many backups to keep (default 14)
#   PGDATABASE              database to save (default salvionix)
#   PG_USER                 superuser of the server (default postgres)
#   DOCUMENTS_DIR           private folder of PDFs (default: <repo>/core-api/.data/documents)
#   PG_RUN                  command prefix that runs the Postgres tools. Default: the local stack's container
#                           ("docker compose ... exec -T db"). Set it to the server's equivalent, or to an empty
#                           string to use pg_dump/psql installed on this machine (then PGHOST, PGPORT, PGPASSWORD apply).
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

fail() { echo "db-backup: $*" >&2; exit 1; }

[ -n "${BACKUP_PASSPHRASE_FILE:-}" ] || fail "set BACKUP_PASSPHRASE_FILE to a file that holds the passphrase"
[ -s "$BACKUP_PASSPHRASE_FILE" ] || fail "the passphrase file is missing or empty"
[ "$(wc -c < "$BACKUP_PASSPHRASE_FILE")" -ge 20 ] || fail "the passphrase is too short (use at least 20 characters)"

BACKUP_DIR="${BACKUP_DIR:-$root/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
PGDATABASE="${PGDATABASE:-salvionix}"
PG_USER="${PG_USER:-postgres}"
DOCUMENTS_DIR="${DOCUMENTS_DIR:-$root/core-api/.data/documents}"
if [ -z "${PG_RUN+x}" ]; then
  PG_RUN="docker compose -f $root/infra/local/docker-compose.yml --env-file $root/infra/local/.env exec -T db"
fi
case "$BACKUP_KEEP" in ''|*[!0-9]*) fail "BACKUP_KEEP must be a number" ;; esac
[ "$BACKUP_KEEP" -ge 1 ] || fail "BACKUP_KEEP must be at least 1"
case "$PGDATABASE" in [a-z]*) ;; *) fail "invalid database name" ;; esac
case "$PGDATABASE" in *[!a-z0-9_]*) fail "invalid database name" ;; esac

gpg_encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none "$@"
}
gpg_decrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt "$@"
}

mkdir -p "$BACKUP_DIR"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

# 1. The database, in Postgres' own compressed format. Roles are not saved: they come from `npm run db:bootstrap`,
#    so no password, not even a hash, ever enters a backup.
# shellcheck disable=SC2086
$PG_RUN pg_dump -U "$PG_USER" -Fc "$PGDATABASE" > "$stage/db.dump"
[ -s "$stage/db.dump" ] || fail "pg_dump produced nothing"
# shellcheck disable=SC2086
$PG_RUN pg_restore --list < "$stage/db.dump" > /dev/null || fail "the dump is not readable"

# 2. The PDFs. The database keeps their hashes; without the files a document would have no PDF to show.
mkdir "$stage/documents"
documents=0
if [ -d "$DOCUMENTS_DIR" ]; then
  for file in "$DOCUMENTS_DIR"/*.pdf; do
    [ -e "$file" ] || continue
    cp -p "$file" "$stage/documents/"
    documents=$((documents + 1))
  done
fi

# 3. What is inside, and a checksum of every file so a restore can tell if anything changed.
# shellcheck disable=SC2086
server_version="$($PG_RUN psql -U "$PG_USER" -d "$PGDATABASE" -Atc 'show server_version' | tr -d '\r')"
{
  echo "created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "database=$PGDATABASE"
  echo "server_version=$server_version"
  echo "documents=$documents"
} > "$stage/INFO"
(cd "$stage" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS)

# 4. One archive, encrypted (AES-256, authenticated: a changed byte makes decryption fail). Written under a
#    temporary name and renamed at the end, so a crash never leaves a half file that looks like a backup.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/salvionix-$stamp.tar.gpg"
(cd "$stage" && tar -cf - .) | gpg_encrypt -o "$out.part"

# 5. Prove the file can be opened with this passphrase before calling it a backup.
gpg_decrypt "$out.part" | tar -tf - > /dev/null || { rm -f "$out.part"; fail "the new backup could not be opened again"; }
mv "$out.part" "$out"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")

# 6. Keep the newest BACKUP_KEEP.
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/salvionix-*.tar.gpg | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "db-backup: $out ($(wc -c < "$out") bytes; database $PGDATABASE, $documents PDF files)"
