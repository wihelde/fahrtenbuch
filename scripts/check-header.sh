#!/usr/bin/env bash
# Check the compact header through the built UI, without changing archive data.
set -euo pipefail
session="fahrtenbuch-header-check"
browser() { agent-browser --session "$session" "$@"; }
trap 'browser close >/dev/null 2>&1 || true' EXIT
browser open "${1:-http://127.0.0.1:4311/}"
browser snapshot -i >/dev/null
browser set viewport 1280 900
browser eval "(() => {
  const main = document.querySelector('main').getBoundingClientRect();
  if (main.left > 60) throw new Error('Sidebar still reserves content width');
  const header = document.querySelector('header');
  const appearance = header.querySelector('button[title^=\"Darstellung:\"]');
  if (!appearance || appearance.getBoundingClientRect().width > 48)
    throw new Error('Compact appearance control missing');
  if (!header.querySelector('button[aria-label=\"CSV importieren\"]'))
    throw new Error('Import not available in header');
  return 'PASS: compact header uses content width and keeps appearance/import';
})()"
browser set viewport 390 844
browser eval "(() => {
  if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Mobile header overflows');
  const header = document.querySelector('header');
  const appearance = header.querySelector('button[title^=\"Darstellung:\"]').getBoundingClientRect();
  const upload = header.querySelector('button[aria-label=\"CSV importieren\"]').getBoundingClientRect();
  if (appearance.width < 44 || appearance.height < 44 || upload.height < 44)
    throw new Error('Header controls too small for touch');
  return 'PASS: mobile header and touch controls';
})()"
browser click 'header button[aria-label="CSV importieren"]'
browser wait --fn "document.querySelector('input[type=file]') !== null"
browser eval "(() => {
  if (!document.querySelector('input[type=file]')) throw new Error('Import did not open');
  return 'PASS: header opens import';
})()"
