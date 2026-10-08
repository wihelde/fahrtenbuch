#!/usr/bin/env bash
# Check rendered colors through the UI, including the CSS produced by the build.
# Requires agent-browser and a running application; it never changes archive data.
set -euo pipefail

session="fahrtenbuch-appearance-check"
browser() { agent-browser --session "$session" "$@"; }
trap 'browser close >/dev/null 2>&1 || true' EXIT
browser open "${1:-http://127.0.0.1:4311/}"
browser snapshot -i >/dev/null

check_mode() {
  browser eval "(() => {
    const button = document.querySelector('button[title^=\"Darstellung:\"]');
    if (!button?.title.startsWith('Darstellung: $1'))
      throw new Error('Expected $1 after one click; got ' + button?.title);
    return 'PASS: $1 selected by direct cycling';
  })()"
}

check_colors() {
  browser eval "(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const brightness = color => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((a, b) => a + b);
    };
    const root = getComputedStyle(document.documentElement);
    const header = getComputedStyle(document.querySelector('.app-header'));
    const light = '$1' === 'light';
    const page = brightness(root.backgroundColor);
    const navigation = brightness(header.backgroundColor);
    const ink = brightness(root.color);
    if (light ? page < 720 || navigation < 660 || ink > 180
              : page > 180 || navigation > 210 || ink < 660) {
      throw new Error('Expected $1 surface and readable text; got ' + JSON.stringify({page, navigation, ink}));
    }
    return 'PASS: $1 surface, header and text';
  })()"
}

browser set media dark
check_colors dark
browser click 'button[title^="Darstellung:"]'
check_mode Hell
check_colors light
browser reload
check_mode Hell
check_colors light
browser set media light
browser click 'button[title^="Darstellung:"]'
check_mode Dunkel
check_colors dark
browser reload
check_mode Dunkel
check_colors dark
browser focus 'button[title^="Darstellung:"]'
browser press Enter
check_mode System
check_colors light
browser set media dark
check_colors dark
browser set media light
check_colors light
browser set viewport 390 844
browser click 'button[title^="Darstellung:"]'
check_mode Hell
check_colors light
browser press Space
check_mode Dunkel
check_colors dark
browser click 'button[title^="Darstellung:"]'
check_mode System
check_colors light
