#!/usr/bin/env bash
# Phase 05 BOOT-01: bootstrap.sh — full first-time-setup pipeline.
# Pipeline: install_gitleaks → create_venv → install_deps → init_database
#           → scaffold_env → generate_secrets → scaffold_mc_config
#           → scaffold_canvas_mc_config
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"
PYTHON="${PYTHON:-python3}"

install_gitleaks() {
  local required="8.30.1"
  if command -v gitleaks >/dev/null 2>&1; then
    local current
    current="$(gitleaks version 2>/dev/null | awk '{print $1}' | sed 's/^v//')"
    if [ "$current" = "$required" ]; then
      echo "[bootstrap] gitleaks $required already installed"
      return 0
    fi
    echo "[bootstrap] gitleaks $current present; replacing with $required"
  fi

  local os arch suffix
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux"  ;;
    *) echo "[bootstrap] ERROR: unsupported OS $(uname -s) (Windows users: use WSL)"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "[bootstrap] ERROR: unsupported arch $(uname -m)"; exit 1 ;;
  esac
  suffix="${os}_${arch}.tar.gz"

  local url="https://github.com/gitleaks/gitleaks/releases/download/v${required}/gitleaks_${required}_${suffix}"
  local tmp; tmp="$(mktemp -d)"
  echo "[bootstrap] downloading $url"
  curl -fsSL "$url" -o "$tmp/gitleaks.tgz" || { echo "[bootstrap] gitleaks download failed"; exit 1; }
  tar -xzf "$tmp/gitleaks.tgz" -C "$tmp"
  local dest="${HOME}/.local/bin"
  mkdir -p "$dest"
  mv "$tmp/gitleaks" "$dest/gitleaks"
  chmod +x "$dest/gitleaks"
  rm -rf "$tmp"

  case ":${PATH}:" in
    *":${dest}:"*) : ;;
    *) echo "[bootstrap] WARN: $dest not in PATH; add: export PATH=\"$dest:\$PATH\"" ;;
  esac

  "$dest/gitleaks" version | grep -q "$required" || { echo "[bootstrap] gitleaks version mismatch after install"; exit 1; }
  echo "[bootstrap] gitleaks $required installed to $dest"
}

create_venv() {
  if [ -d "$VENV" ]; then
    echo "[bootstrap] venv already at $VENV"
  else
    echo "[bootstrap] creating venv at $VENV"
    "$PYTHON" -m venv "$VENV"
  fi
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
  python -m pip install --upgrade pip setuptools wheel
}

install_deps() {
  local req
  if [ -f "$ROOT/openclaw-vtuber/server/requirements.txt" ]; then
    req="$ROOT/openclaw-vtuber/server/requirements.txt"
  elif [ -f "$ROOT/requirements.txt" ]; then
    req="$ROOT/requirements.txt"
  else
    echo "[bootstrap] ERROR: no requirements.txt found"; exit 1
  fi
  echo "[bootstrap] installing $req"
  pip install -r "$req"
  pip install pre-commit   # for HARDEN-02 hook (Plan 02)
  pre-commit install
}

init_database() {
  echo "[bootstrap] initializing SQLite database"
  python "$ROOT/scripts/init-db.py"
}

scaffold_env() {
  if [ -f "$ROOT/.env" ]; then
    echo "[bootstrap] .env already present; not overwriting"
    return 0
  fi
  if [ ! -f "$ROOT/.env.example" ]; then
    echo "[bootstrap] ERROR: .env.example missing"; exit 1
  fi
  cp "$ROOT/.env.example" "$ROOT/.env"
  chmod 600 "$ROOT/.env"
  echo "[bootstrap] copied .env.example → .env (placeholders intact — fill in keys before running)"
}

scaffold_mc_config() {
  local target="$ROOT/config/mission-control.json"
  local example="$ROOT/config/mission-control.json.example"
  if [ -f "$target" ]; then
    echo "[bootstrap] $target already present"
    return 0
  fi
  if [ ! -f "$example" ]; then
    echo "[bootstrap] WARN: $example missing; skipping"
    return 0
  fi
  mkdir -p "$ROOT/config"
  cp "$example" "$target"
  echo "[bootstrap] copied mission-control.json.example → mission-control.json"
}

# Plan 05-13: fill BRIDGE_AUTH_TOKEN with a per-install random secret if blank.
# Idempotent — only writes when the line is `BRIDGE_AUTH_TOKEN=` (no value).
generate_secrets() {
  local env="$ROOT/.env"
  if [ ! -f "$env" ]; then
    echo "[bootstrap] WARN: .env missing; skipping secret generation"
    return 0
  fi
  if grep -qE '^BRIDGE_AUTH_TOKEN=.+' "$env"; then
    echo "[bootstrap] BRIDGE_AUTH_TOKEN already set; not regenerating"
    return 0
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[bootstrap] ERROR: openssl required to generate BRIDGE_AUTH_TOKEN"; exit 1
  fi
  local token
  token="$(openssl rand -hex 32)"
  # Portable in-place replace of the empty line (works on BSD + GNU sed via tmp file)
  local tmp; tmp="$(mktemp)"
  awk -v t="$token" '/^BRIDGE_AUTH_TOKEN=$/ { print "BRIDGE_AUTH_TOKEN=" t; next } { print }' "$env" > "$tmp"
  mv "$tmp" "$env"
  chmod 600 "$env"
  echo "[bootstrap] generated BRIDGE_AUTH_TOKEN (per-install secret)"
}

# Plan 05-13: scaffold canvas dashboard config from .example, injecting the
# matching BRIDGE_AUTH_TOKEN so the dashboard can talk to the bridge server.
scaffold_canvas_mc_config() {
  local target="$ROOT/config/canvas/mission-control.json"
  local example="$ROOT/config/canvas/mission-control.json.example"
  local env="$ROOT/.env"
  if [ -f "$target" ]; then
    echo "[bootstrap] $target already present"
    return 0
  fi
  if [ ! -f "$example" ]; then
    echo "[bootstrap] WARN: $example missing; skipping canvas config"
    return 0
  fi
  if [ ! -f "$env" ]; then
    echo "[bootstrap] WARN: .env missing; skipping canvas config"
    return 0
  fi
  local token
  token="$(grep -E '^BRIDGE_AUTH_TOKEN=' "$env" | head -1 | cut -d= -f2-)"
  if [ -z "$token" ]; then
    echo "[bootstrap] WARN: BRIDGE_AUTH_TOKEN empty in .env; canvas config will have blank token"
  fi
  mkdir -p "$ROOT/config/canvas"
  # Inline-substitute the empty bridge_token field in the example
  awk -v t="$token" '
    /"bridge_token"[[:space:]]*:[[:space:]]*""/ {
      sub(/"bridge_token"[[:space:]]*:[[:space:]]*""/, "\"bridge_token\": \"" t "\"")
    }
    { print }
  ' "$example" > "$target"
  chmod 600 "$target"
  echo "[bootstrap] scaffolded canvas/mission-control.json with per-install bridge_token"
}

main() {
  install_gitleaks
  create_venv
  install_deps
  init_database
  scaffold_env
  generate_secrets
  scaffold_mc_config
  scaffold_canvas_mc_config
  echo ""
  echo "[bootstrap] DONE. Next: edit .env, then run ./mission-control.sh"
}
main "$@"
