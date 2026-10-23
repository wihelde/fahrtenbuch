#!/usr/bin/env bash
# Check chart width and modal interactions against the built application, without editing trips.
set -euo pipefail
session="fahrtenbuch-chart-dialog-check"
browser() { agent-browser --session "$session" "$@"; }
trap 'browser close >/dev/null 2>&1 || true' EXIT
browser open "${1:-http://127.0.0.1:4311/}"
browser snapshot -i >/dev/null
browser select '.trip-filters label:first-child select' all
browser wait --fn "document.querySelector('.trip-section').getAttribute('aria-busy') === 'false'"
browser scrollintoview '.developments-heading .chart-granularity'
browser click '.developments-heading .chart-granularity button:last-child'
browser eval "(() => {
  const plots = [...document.querySelectorAll('.month-bars')];
  if (plots.some(p => p.scrollWidth > p.clientWidth + 1)) throw new Error('Chart needs horizontal scrolling');
  for (const plot of plots) {
    if (getComputedStyle(plot, '::before').backgroundColor === 'rgba(0, 0, 0, 0)')
      throw new Error('Shared chart background missing');
    const tracks = [...plot.querySelectorAll('.bar-track')].slice(1, -1);
    if (tracks.some(track => {
      const style = getComputedStyle(track);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.borderTopLeftRadius !== '0px';
    })) throw new Error('Individual rounded backgrounds create chart gaps');
  }
  return 'PASS: overview fits available width without rounded background gaps';
})()"
browser click 'button[aria-label="Gefahrene Kilometer vergrößern"]'
browser wait --fn "document.querySelector('.chart-dialog')?.open === true"
browser eval "(() => {
  const dialog = document.querySelector('.chart-dialog');
  if (dialog.getBoundingClientRect().width < innerWidth * 0.85 || dialog.scrollWidth > dialog.clientWidth + 1)
    throw new Error('Expanded chart does not use the window width');
  const slider = dialog.querySelector('input[type=range]');
  if (slider.value !== slider.max) throw new Error('Newest period not selected');
  return 'PASS: wide modal with latest period selected';
})()"
browser focus '.chart-dialog input[type=range]'
browser press Home
browser wait --fn "document.querySelector('.trip-section').getAttribute('aria-busy') === 'false'"
browser eval "window.chartSelectedPeriod = document.querySelector('.chart-dialog .chart-selection > span').textContent"
browser click '.chart-dialog button[data-measure="cost"]'
browser eval "(() => {
  const dialog = document.querySelector('.chart-dialog');
  if (dialog.querySelector('.chart-selection > span').textContent !== window.chartSelectedPeriod)
    throw new Error('Period lost when switching measure');
  if (!dialog.textContent.includes('Kraftstoffkosten')) throw new Error('Wrong measure');
  const [from, to] = document.querySelectorAll('.trip-filters input[type=date]');
  if (from.value || to.value) throw new Error('Slider changed the overview range');
  if (!document.querySelector('.chart-filter-note')) throw new Error('Table does not identify its chart selection');
  return 'PASS: measure switch preserves period';
})()"
browser hover '.chart-dialog .month-bar[aria-pressed="true"]'
browser eval "(() => {
  const tooltip = document.querySelector('.chart-dialog [role=tooltip]');
  if (!tooltip?.textContent.includes('Kraftstoffkosten')) throw new Error('Tooltip is missing inside modal');
  return 'PASS: modal tooltip';
})()"
browser focus '.chart-dialog .month-bar[aria-pressed="true"]'
browser press End
browser eval "(() => {
  const dialog = document.querySelector('.chart-dialog');
  const slider = dialog.querySelector('input[type=range]');
  if (slider && slider.value !== slider.max) throw new Error('Keyboard did not select newest period');
  const selected = dialog.querySelector('.chart-selection > span').textContent;
  if ([...document.querySelectorAll('.monthly-plots .chart-selection > span')].some(s => s.textContent !== selected))
    throw new Error('Overview did not share modal selection');
  return 'PASS: keyboard selection is shared with overview';
})()"
browser click '.chart-dialog .chart-granularity[aria-label="Diagrammansicht"] button:first-child'
browser click '.chart-dialog button[data-measure="distanceKm"]'
browser eval "(() => {
  const dialog = document.querySelector('.chart-dialog');
  if (dialog.querySelector('figcaption p').textContent !== 'Summe je Monat')
    throw new Error('Monthly view did not update');
  const slider = dialog.querySelector('input[type=range]');
  if (slider && slider.value !== slider.max) throw new Error('Monthly view did not select newest period');
  return 'PASS: monthly view inside modal';
})()"
browser press Escape
browser wait --fn "document.querySelector('.chart-dialog') === null"
browser eval "(() => {
  if (document.activeElement?.getAttribute('aria-label') !== 'Gefahrene Kilometer vergrößern')
    throw new Error('Focus did not return to opener');
  return 'PASS: Escape closes modal and returns focus';
})()"
browser set viewport 390 844
browser scrollintoview 'button[aria-label="Gefahrene Kilometer vergrößern"]'
browser click 'button[aria-label="Gefahrene Kilometer vergrößern"]'
browser wait --fn "document.querySelector('.chart-dialog')?.open === true"
browser eval "(() => {
  const dialog = document.querySelector('.chart-dialog');
  if (dialog.getBoundingClientRect().width < innerWidth - 2 || dialog.scrollWidth > dialog.clientWidth + 1)
    throw new Error('Mobile dialog does not fit screen');
  return 'PASS: fullscreen mobile chart';
})()"
browser click '.chart-dialog .chart-dialog-close'
browser wait --fn "document.querySelector('.chart-dialog') === null"
