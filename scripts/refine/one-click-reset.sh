#!/usr/bin/env bash

set -euo pipefail

timestamp() {
  date "+%Y%m%d-%H%M%S"
}

log() {
  printf "[reset] %s\n" "$*"
}

warn() {
  printf "[reset][warn] %s\n" "$*" >&2
}

usage() {
  cat <<'USAGE'
One-click reset for refine runtime/config with credential preservation.

Usage:
  scripts/refine/one-click-reset.sh [options]

Options:
  --yes                      Skip confirmation prompt
  --skip-auth-save           Do not run "pb auth save"
  --skip-restore-auth        Do not restore accounts.json/credentials.json after re-init
  --no-stop-services         Do not run "pb service stop all"
  --config-dir <path>        Config dir (default: ${PONYBUNNY_CONFIG_DIR:-$HOME/.config/ponybunny})
  --runtime-dir <path>       Runtime dir to clean (default: $HOME/.ponybunny)
  --backup-root <path>       Backup root (default: $HOME/.ponybunny-reset-backups)
  -h, --help                 Show this help

What this script does:
  1) Stops services (optional)
  2) Runs "pb auth save" to vault current credentials (interactive passkey)
  3) Backs up config/runtime directories
  4) Cleans runtime + config directories
  5) Runs "pb init --force" to regenerate full default config
  6) Restores accounts.json and credentials.json by default
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "[reset][error] Required command not found: %s\n" "$1" >&2
    exit 1
  fi
}

confirm_or_exit() {
  local message="$1"
  if [[ ! -t 0 ]]; then
    printf "[reset][error] Non-interactive shell detected. Re-run with --yes.\n" >&2
    exit 1
  fi
  printf "%s [y/N]: " "$message"
  local answer
  read -r answer
  case "${answer}" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      log "Cancelled"
      exit 1
      ;;
  esac
}

default_config_dir="${PONYBUNNY_CONFIG_DIR:-$HOME/.config/ponybunny}"
config_dir="$default_config_dir"
runtime_dir="$HOME/.ponybunny"
backup_root="$HOME/.ponybunny-reset-backups"
skip_auth_save=false
skip_restore_auth=false
stop_services=true
assume_yes=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      assume_yes=true
      shift
      ;;
    --skip-auth-save)
      skip_auth_save=true
      shift
      ;;
    --skip-restore-auth)
      skip_restore_auth=true
      shift
      ;;
    --no-stop-services)
      stop_services=false
      shift
      ;;
    --config-dir)
      config_dir="$2"
      shift 2
      ;;
    --runtime-dir)
      runtime_dir="$2"
      shift 2
      ;;
    --backup-root)
      backup_root="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf "[reset][error] Unknown option: %s\n\n" "$1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd pb
require_cmd cp
require_cmd rm
require_cmd mkdir

config_dir="${config_dir/#\~/$HOME}"
runtime_dir="${runtime_dir/#\~/$HOME}"
backup_root="${backup_root/#\~/$HOME}"

run_id="$(timestamp)"
backup_dir="$backup_root/$run_id"
config_backup_dir="$backup_dir/config"
runtime_backup_dir="$backup_dir/runtime"
auth_backup_dir="$backup_dir/auth"

if [[ "$assume_yes" != true ]]; then
  confirm_or_exit "This will reset runtime + config and regenerate defaults. Continue"
fi

mkdir -p "$config_backup_dir" "$runtime_backup_dir" "$auth_backup_dir"

log "Config dir: $config_dir"
log "Runtime dir: $runtime_dir"
log "Backup dir: $backup_dir"

credentials_file="$config_dir/credentials.json"
accounts_file="$config_dir/accounts.json"

if [[ "$stop_services" == true ]]; then
  log "Stopping services via: pb service stop all"
  if ! pb service stop all; then
    warn "Service stop returned non-zero; continuing"
  fi
fi

if [[ "$skip_auth_save" == false ]]; then
  if [[ -f "$credentials_file" ]]; then
    log "Saving credentials to vault via: pb auth save"
    pb auth save
  else
    warn "No credentials.json found at $credentials_file; skipping pb auth save"
  fi
else
  warn "Skipping pb auth save by option"
fi

if [[ -d "$config_dir" ]]; then
  log "Backing up current config directory"
  cp -a "$config_dir/." "$config_backup_dir/"
fi

if [[ -d "$runtime_dir" ]]; then
  log "Backing up current runtime directory"
  cp -a "$runtime_dir/." "$runtime_backup_dir/"
fi

if [[ -f "$credentials_file" ]]; then
  cp -a "$credentials_file" "$auth_backup_dir/credentials.json"
  chmod 600 "$auth_backup_dir/credentials.json"
fi

if [[ -f "$accounts_file" ]]; then
  cp -a "$accounts_file" "$auth_backup_dir/accounts.json"
  chmod 600 "$auth_backup_dir/accounts.json"
fi

log "Cleaning runtime and config directories"
rm -rf "$runtime_dir"
rm -rf "$config_dir"
mkdir -p "$config_dir"

log "Regenerating full default config with: pb init --force"
pb init --force

if [[ "$skip_restore_auth" == false ]]; then
  if [[ -f "$auth_backup_dir/credentials.json" ]]; then
    cp -a "$auth_backup_dir/credentials.json" "$credentials_file"
    chmod 600 "$credentials_file"
    log "Restored credentials.json"
  else
    warn "No credentials.json backup found to restore"
  fi

  if [[ -f "$auth_backup_dir/accounts.json" ]]; then
    cp -a "$auth_backup_dir/accounts.json" "$accounts_file"
    chmod 600 "$accounts_file"
    log "Restored accounts.json"
  else
    warn "No accounts.json backup found to restore"
  fi
else
  warn "Skipping auth file restore by option"
fi

log "One-click reset completed"
log "Backups saved under: $backup_dir"
log "Next step: pb service start all"
