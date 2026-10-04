#!/usr/bin/env bash
# AI analysis relay as a USER systemd service (no sudo):
# starts at login, restarts if it crashes.
#
#   npm run ia:install     installs + starts
#   npm run ia:uninstall   stops + removes
#   npm run ia:status      status + last log lines (token included)
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/budget-ia.service"
NODE="$(command -v node)"
CLAUDE_DIR="$(dirname "$(command -v claude)")"

case "${1:-}" in
install)
	mkdir -p "$UNIT_DIR"
	cat >"$UNIT" <<EOF
[Unit]
Description=Relais Analyse IA (app budget) -> Claude Code headless
After=default.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE "$APP_DIR/node_modules/tsx/dist/cli.mjs" scripts/ia-relay.ts
Environment=PATH=$CLAUDE_DIR:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
	systemctl --user daemon-reload
	systemctl --user enable --now budget-ia.service
	echo "Installé : $UNIT"
	systemctl --user --no-pager status budget-ia.service | head -5
	;;
uninstall)
	systemctl --user disable --now budget-ia.service 2>/dev/null || true
	rm -f "$UNIT"
	systemctl --user daemon-reload
	echo "Service supprimé."
	;;
status)
	systemctl --user --no-pager status budget-ia.service | head -5 || true
	journalctl --user -u budget-ia.service -n 8 --no-pager -o cat || true
	;;
*)
	echo "Usage : $0 install | uninstall | status" >&2
	exit 1
	;;
esac
