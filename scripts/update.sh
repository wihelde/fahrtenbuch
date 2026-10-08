#!/bin/sh
set -eu

repository=$(dirname "$(dirname "$(readlink -f "$0")")")
app_home=$(dirname "$repository")
compose="$app_home/compose"
. "$app_home/.envrc"

if [ "$(id -u)" -ne 0 ]; then
  echo 'Bitte als root ausführen: fahrtenbuch-update' >&2
  exit 1
fi
exec 9>"$app_home/update.lock"
flock -n 9 || { echo 'Ein Update läuft bereits.' >&2; exit 1; }
test "$(git -C "$repository" branch --show-current)" = main
if [ -n "$(git -C "$repository" status --porcelain)" ]; then
  echo 'Lokale Änderungen im Repository. Update abgebrochen.' >&2
  exit 1
fi
test -d "$DATA_DIR"
old_commit=$(cat "$app_home/deployed-commit")
container=$("$compose" ps --status running -q fahrtenbuch)
test -n "$container" || { echo 'Die Anwendung läuft nicht. Bitte zuerst prüfen.' >&2; exit 1; }

git -C "$repository" pull --ff-only
new_commit=$(git -C "$repository" rev-parse HEAD)
if [ "$new_commit" = "$old_commit" ]; then
  echo 'Fahrtenbuch ist bereits aktuell.'
  exit 0
fi

# Erst bauen: Ein Buildfehler darf die laufende Anwendung nicht stoppen.
"$compose" build
install -d -m 0700 "$app_home/backups"
backup=$(mktemp -d "$app_home/backups/$(date +%Y%m%d-%H%M%S)-XXXXXX")
rollback_image="fahrtenbuch:before-update-$(basename "$backup")"
old_image=$(docker inspect --format '{{.Image}}' "$container")
docker image tag "$old_image" "$rollback_image"
printf '%s\n' "$old_commit" > "$backup/version.txt"
printf '%s\n' "$rollback_image" > "$backup/rollback-image.txt"
git -C "$repository" archive -o "$backup/source.tar" "$old_commit"
cp -a "$app_home/.envrc" "$backup/"
cp -L "$compose" "$backup/compose"
cp -L "$app_home/update" "$backup/update"

paused=0
restart_if_backup_fails() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$paused" = 1 ]; then
    "$compose" start fahrtenbuch || echo 'Wiederstart fehlgeschlagen. Bitte Anwendung prüfen.' >&2
  fi
  exit "$result"
}
trap restart_if_backup_fails EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
paused=1
"$compose" stop --timeout 30 fahrtenbuch
running=$("$compose" ps --status running -q fahrtenbuch)
test -z "$running"
cp -a "$DATA_DIR" "$backup/data"
echo "Sicherung: $backup"

# Nach einem Startversuch könnte die Datenbank migriert sein: kein blinder Rücksprung.
paused=0
if ! "$compose" up -d --no-build --force-recreate fahrtenbuch; then
  echo "Start fehlgeschlagen. Alte Version und Fahrtdaten sind in $backup gesichert." >&2
  exit 1
fi
if ! curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 5 "http://127.0.0.1:${PORT:-3000}/api/imports" > /dev/null; then
  echo "Anwendung antwortet nicht. Bitte Logs und Sicherung $backup prüfen." >&2
  exit 1
fi
printf '%s\n' "$new_commit" > "$app_home/deployed-commit.new"
mv "$app_home/deployed-commit.new" "$app_home/deployed-commit"
echo "Fahrtenbuch erfolgreich aktualisiert: $new_commit"
