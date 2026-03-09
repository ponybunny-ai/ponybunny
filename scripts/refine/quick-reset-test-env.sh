#!/usr/bin/env bash

set -euo pipefail

CONFIG_DIR="${PONYBUNNY_CONFIG_DIR:-$HOME/.config/ponybunny}"
RUNTIME_DIR="$HOME/.ponybunny"
BACKUP_ROOT="$HOME/.ponybunny-reset-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

say() {
  printf "[quick-reset] %s\n" "$*"
}

warn() {
  printf "[quick-reset][warn] %s\n" "$*" >&2
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "[quick-reset][error] Missing command: %s\n" "$1" >&2
    exit 1
  fi
}

need pb

if [[ "${1:-}" != "--yes" ]]; then
  if [[ ! -t 0 ]]; then
    printf "[quick-reset][error] Non-interactive shell. Re-run with --yes\n" >&2
    exit 1
  fi
  printf "This will reset to a clean config/runtime and restore credential+provider data. Continue? [y/N]: "
  read -r ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) say "Cancelled"; exit 1 ;;
  esac
fi

mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/config"

VAULT_DIR="$CONFIG_DIR/vault"
VAULT_BACKUP_DIR="$BACKUP_DIR/vault"

say "Stopping services"
if ! pb service stop all; then
  warn "pb service stop all returned non-zero; continuing"
fi

if [[ -d "$VAULT_DIR" ]]; then
  say "Moving vault to backup before config cleanup"
  mv "$VAULT_DIR" "$VAULT_BACKUP_DIR"
else
  warn "No vault directory found, nothing to preserve"
fi

for f in credentials.json accounts.json llm-config.json; do
  if [[ -f "$CONFIG_DIR/$f" ]]; then
    cp -a "$CONFIG_DIR/$f" "$BACKUP_DIR/config/$f"
  fi
done

if [[ -d "$RUNTIME_DIR" ]]; then
  cp -a "$RUNTIME_DIR" "$BACKUP_DIR/runtime"
fi

say "Cleaning runtime + config"
rm -rf "$RUNTIME_DIR"
rm -rf "$CONFIG_DIR"
mkdir -p "$CONFIG_DIR"

say "Generating fresh default config"
pb init --force

say "Restoring credential + provider data"
if [[ -f "$BACKUP_DIR/config/credentials.json" ]]; then
  cp -a "$BACKUP_DIR/config/credentials.json" "$CONFIG_DIR/credentials.json"
  chmod 600 "$CONFIG_DIR/credentials.json"
fi
if [[ -f "$BACKUP_DIR/config/accounts.json" ]]; then
  cp -a "$BACKUP_DIR/config/accounts.json" "$CONFIG_DIR/accounts.json"
  chmod 600 "$CONFIG_DIR/accounts.json"
fi
if [[ -f "$BACKUP_DIR/config/llm-config.json" ]]; then
  cp -a "$BACKUP_DIR/config/llm-config.json" "$CONFIG_DIR/llm-config.json"
fi

if [[ -d "$VAULT_BACKUP_DIR" ]]; then
  say "Moving vault back after reset"
  mv "$VAULT_BACKUP_DIR" "$VAULT_DIR"
fi

say "Done"
say "Backup saved: $BACKUP_DIR"
say "Start services with: pb service start all"
