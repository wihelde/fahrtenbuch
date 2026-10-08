# Backups, restores, and updates

Run these commands on the Docker host, in the repository directory, with the same configuration and Compose project name used at startup. If you use `docker compose -p NAME`, include that option throughout.

## What to preserve

Back up the entire host `DATA_DIR`: SQLite and any WAL/sidecar files, original exports, corrections, and cached routes. Stop the application cleanly before copying. Copying only a live SQLite database file is insufficient.

A bind mount preserves data across container recreation but does not protect against host or disk loss. Keep a private copy on a separate device. Exports and backups contain location data and must not be committed or included in container images.

## Create a backup

1. Load your usual configuration and check the resolved data path, port, and user. Choose a backup directory outside `DATA_DIR`.

   ```sh
   export DATA_DIR="${DATA_DIR:-$PWD/data}"
   export DOCKER_USER="${DOCKER_USER:-$(id -u):$(id -g)}"
   export BACKUP_DIR="$HOME/fahrtenbuch-backups/$(date +%Y%m%d-%H%M%S)"
   docker compose config
   ```

2. Stop the application. Confirm the service is stopped before copying.

   ```sh
   docker compose stop --timeout 30
   docker compose ps --all
   ```

3. Copy the complete archive into a new backup destination. The target `data` must not exist; do not merge different archive states. Record the application source version and retain its local configuration privately.

   ```sh
   mkdir -p "$BACKUP_DIR"
   chmod 700 "$BACKUP_DIR"
   cp -a "$DATA_DIR" "$BACKUP_DIR/data"
   git rev-parse HEAD > "$BACKUP_DIR/version.txt"
   git status --short > "$BACKUP_DIR/working-tree.txt"
   ```

   These version commands assume a Git checkout. A commit ID alone does not capture uncommitted changes: retain the exact source package or a clean committed version as well. If using a downloaded source archive, preserve that package and its version instead. Record custom `DATA_DIR`, `DOCKER_USER`, and Compose project settings separately.

4. Restart the existing version and check known journeys, corrections, and an original download.

   ```sh
   docker compose start
   docker compose logs --tail=50 fahrtenbuch
   ```

If copying fails, no successful backup has been established. Restart the existing service if necessary, resolve the error, and repeat before attempting an update. Copy the completed backup to a separate private device.

## Restore into a new directory

Use the same or a compatible newer application version for the backup. On a new host, first make the matching source available and build its image. Never merge old and new SQLite files into the same directory.

Replace the example backup timestamp with your chosen backup, load the usual configuration, and run each step separately:

```sh
export BACKUP_DIR="$HOME/fahrtenbuch-backups/20261008-120000"
mkdir -p "$HOME/fahrtenbuch-archives"
chmod 700 "$HOME/fahrtenbuch-archives"
export RESTORE_DIR="$HOME/fahrtenbuch-archives/restored-$(date +%Y%m%d-%H%M%S)"
docker compose stop --timeout 30
docker compose down
cp -a "$BACKUP_DIR/data" "$RESTORE_DIR"
export DATA_DIR="$RESTORE_DIR"
docker compose up -d --no-build
```

The restored directory must be writable by the configured `DOCKER_USER`; copying it as a different user may require correcting ownership before startup. If the matching image is absent, run `docker compose build` before the final command.

Verify trip count, manual and imported values, an original download, and a previously cached route. Cached routes need no new routing request; new routes and map tiles still depend on external services.

Persist the new absolute `DATA_DIR` in your private configuration and reload it for future commands. Retain the previous archive until the restore has been verified.

## Update to a specific version

First create a full backup as above and keep its `BACKUP_DIR` active in the same shell. The following source-switching commands assume a clean Git checkout and the new tag or commit is already available locally. Do not discard local changes; use a separate checkout or retain the source package when needed.

1. Keep the running image under a distinct local tag. Record both image names alongside the backup.

   ```sh
   export APP_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q fahrtenbuch)")"
   export ROLLBACK_IMAGE="fahrtenbuch:before-update-$(date +%Y%m%d-%H%M%S)"
   docker image tag "$APP_IMAGE" "$ROLLBACK_IMAGE"
   printf '%s\n' "$APP_IMAGE" > "$BACKUP_DIR/image-name.txt"
   printf '%s\n' "$ROLLBACK_IMAGE" > "$BACKUP_DIR/rollback-image.txt"
   ```

   Do not prune this image while it is needed for rollback. A local tag is not an off-host image backup.

2. Stop the service, select the exact new version, build, and start. Replace `NEW-TAG-OR-COMMIT` with a real local reference. Retain the same private configuration and data path.

   ```sh
   docker compose stop --timeout 30
   export UPDATE_REF=NEW-TAG-OR-COMMIT
   git switch --detach "$UPDATE_REF"
   docker compose build
   docker compose up -d --no-build --force-recreate
   docker compose logs --tail=100 fahrtenbuch
   ```

3. Verify trip count, original downloads, corrections, and an existing cached route. If the build or startup fails, return to the preserved version and its pre-update data rather than continuing with an unknown image.

Database migrations can run on startup. An old image alone cannot undo a migrated database; a rollback also requires the full archive backup from before the update.

## Roll back after an unsuccessful update

Load the original configuration and select the exact backup made before this update. These commands require the preserved image and a backup from a clean Git version; for a source-package deployment, select the corresponding old source package instead of the `git switch` step.

```sh
export BACKUP_DIR="$HOME/fahrtenbuch-backups/20261008-120000"
docker compose stop --timeout 30
docker compose down
export OLD_COMMIT="$(cat "$BACKUP_DIR/version.txt")"
export APP_IMAGE="$(cat "$BACKUP_DIR/image-name.txt")"
export ROLLBACK_IMAGE="$(cat "$BACKUP_DIR/rollback-image.txt")"
git switch --detach "$OLD_COMMIT"
mkdir -p "$HOME/fahrtenbuch-archives"
chmod 700 "$HOME/fahrtenbuch-archives"
export RESTORE_DIR="$HOME/fahrtenbuch-archives/rollback-$(date +%Y%m%d-%H%M%S)"
cp -a "$BACKUP_DIR/data" "$RESTORE_DIR"
export DATA_DIR="$RESTORE_DIR"
docker image tag "$ROLLBACK_IMAGE" "$APP_IMAGE"
docker compose up -d --no-build --force-recreate
```

The older application uses the restored pre-update archive. Later imports or edits remain only in the previous directory and are not part of this rollback. Verify the restored values and original files, persist the restored `DATA_DIR`, and keep the previous archive until verification succeeds.

The application does not configure automated backups. If using Proxmox, include the guest's archive storage in your backup plan. A Proxmox host bind mount into an LXC is different from the Docker bind mount inside the guest and needs separate backup coverage.
