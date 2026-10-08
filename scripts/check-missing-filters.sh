#!/usr/bin/env bash
# Exercise the actual selector and visible trip cells without changing archive data.
set -euo pipefail
session="fahrtenbuch-missing-filter-check"
browser() { agent-browser --session "$session" "$@"; }
trap 'browser close >/dev/null 2>&1 || true' EXIT
browser open "${1:-http://127.0.0.1:4311/}"
browser snapshot -i >/dev/null
browser select '.trip-filters label:first-child select' all

for mode in any consumption cost ''; do
  browser select 'select[name="missing"]' "$mode"
  browser wait --fn "document.querySelector('.trip-section').getAttribute('aria-busy') === 'false' && document.querySelector('select[name=missing]').value === '$mode'"
  browser eval "(() => {
    const mode = '$mode';
    const labels = {any: 'Verbrauch oder Kosten fehlen', consumption: 'Verbrauch fehlt', cost: 'Kosten fehlen'};
    const status = document.querySelector('.filter-status').textContent;
    if (document.querySelector('.notice.error')) throw new Error('Filter request failed');
    if (mode ? !status.includes(labels[mode]) : status.trim() !== 'Alle Fahrten')
      throw new Error('Requested filter was not applied: ' + status);
    const rows = [...document.querySelectorAll('.desktop-table tbody tr')];
    for (const row of rows) {
      const consumptionMissing = row.cells[5].textContent.includes('Keine Angabe');
      const costMissing = row.cells[6].textContent.includes('Keine Angabe');
      if (mode === 'any' && !consumptionMissing && !costMissing ||
          mode === 'consumption' && !consumptionMissing ||
          mode === 'cost' && !costMissing) throw new Error('Complete trip remains in ' + mode + ' selection');
    }
    return 'PASS: ' + (mode || 'all') + ' filter; ' + status;
  })()"
done
