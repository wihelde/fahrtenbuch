#!/usr/bin/env bash
# Selecting a category applies it immediately through the UI, without editing trips.
set -euo pipefail
session="fahrtenbuch-category-filter-check"
browser() { agent-browser --session "$session" "$@"; }
trap 'browser close >/dev/null 2>&1 || true' EXIT
browser open "${1:-http://127.0.0.1:4311/}"
browser snapshot -i >/dev/null
browser select '.trip-filters label:first-child select' all
browser wait --fn "document.querySelector('.trip-section').getAttribute('aria-busy') === 'false'"

for category in Freizeit Geschäftlich ''; do
  browser select '.trip-filters label:nth-child(4) select' "$category"
  browser wait --fn "document.querySelector('.trip-section').getAttribute('aria-busy') === 'false'"
  browser eval "(() => {
    const category = '$category';
    const status = document.querySelector('.filter-status').textContent;
    if (document.querySelector('.notice.error')) throw new Error('Filter request failed');
    if (category ? !status.includes(category) : status.trim() !== 'Alle Fahrten')
      throw new Error('Category did not apply immediately: ' + status);
    const rows = [...document.querySelectorAll('.desktop-table tbody tr')];
    if (category && rows.some(row => row.cells[7].textContent.trim() !== category))
      throw new Error('Trip outside selected category remains visible');
    const count = document.querySelector('.archive-summary dd').textContent;
    if (category && !status.startsWith(count + ' Treffer'))
      throw new Error('Summary and filtered list disagree');
    return 'PASS: ' + (category || 'all categories') + '; ' + status;
  })()"
done
