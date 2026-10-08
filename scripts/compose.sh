#!/bin/sh
set -eu

repository=$(dirname "$(dirname "$(readlink -f "$0")")")
app_home=$(dirname "$repository")
. "$app_home/.envrc"
cd "$repository"
exec docker compose -p fahrtenbuch "$@"
