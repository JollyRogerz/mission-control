#!/usr/bin/env bash
# setup.sh — Mission Control's single first-time-setup pipeline.
#
# Pipeline (default):
#   gitleaks → venv → deps → DB → scaffold .env → secrets
#   → scaffold mc config → scaffold canvas config → interactive wizard
#
# Flags:
#   --no-wizard      Run mechanical bits only; skip the interactive wizard.
#                    Auto-set when stdin is not a TTY (CI / piped input).
#   --reconfigure    Skip the mechanical pipeline; jump straight to the
#                    wizard. Assumes a previous successful setup.
#
# The wizard hard-fails on validation (bad keys are never saved) and detects
# existing state, so re-running this script is always safe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"
ENV_FILE="$ROOT/.env"
AGENTS_DIR="$ROOT/config/agents"
PYTHON="${PYTHON:-python3}"

# ── Flag parsing ───────────────────────────────────────────────────────────
RUN_WIZARD="yes"
RUN_BOOTSTRAP="yes"
for arg in "$@"; do
  case "$arg" in
    --no-wizard)   RUN_WIZARD="no" ;;
    --reconfigure) RUN_BOOTSTRAP="no" ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "[setup] unknown flag: $arg" >&2; exit 2 ;;
  esac
done
# CI / piped-input safety: no TTY → no wizard. On default run, auto-skip
# silently. With --reconfigure (user explicitly asked for the wizard),
# refuse — running the wizard against a closed stdin would hang on read.
if [ ! -t 0 ] && [ "$RUN_WIZARD" = "yes" ]; then
  if [ "$RUN_BOOTSTRAP" = "no" ]; then
    echo "[setup] --reconfigure needs an interactive terminal" >&2
    exit 1
  fi
  echo "[setup] non-interactive stdin detected — skipping wizard (run ./setup.sh --reconfigure on a TTY later)"
  RUN_WIZARD="no"
fi

# ════════════════════════════════════════════════════════════════════════════
#  STAGE 1 — Mechanical bootstrap
# ════════════════════════════════════════════════════════════════════════════

install_gitleaks() {
  local required="8.30.1"
  if command -v gitleaks >/dev/null 2>&1; then
    local current
    current="$(gitleaks version 2>/dev/null | awk '{print $1}' | sed 's/^v//')"
    if [ "$current" = "$required" ]; then
      echo "[setup] gitleaks $required already installed"
      return 0
    fi
    echo "[setup] gitleaks $current present; replacing with $required"
  fi

  local os arch suffix
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux"  ;;
    *) echo "[setup] ERROR: unsupported OS $(uname -s) (Windows users: use WSL)"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "[setup] ERROR: unsupported arch $(uname -m)"; exit 1 ;;
  esac
  suffix="${os}_${arch}.tar.gz"

  local url="https://github.com/gitleaks/gitleaks/releases/download/v${required}/gitleaks_${required}_${suffix}"
  local tmp; tmp="$(mktemp -d)"
  echo "[setup] downloading $url"
  curl -fsSL "$url" -o "$tmp/gitleaks.tgz" || { echo "[setup] gitleaks download failed"; exit 1; }
  tar -xzf "$tmp/gitleaks.tgz" -C "$tmp"
  local dest="${HOME}/.local/bin"
  mkdir -p "$dest"
  mv "$tmp/gitleaks" "$dest/gitleaks"
  chmod +x "$dest/gitleaks"
  rm -rf "$tmp"

  case ":${PATH}:" in
    *":${dest}:"*) : ;;
    *) echo "[setup] WARN: $dest not in PATH; add: export PATH=\"$dest:\$PATH\"" ;;
  esac

  "$dest/gitleaks" version | grep -q "$required" || { echo "[setup] gitleaks version mismatch after install"; exit 1; }
  echo "[setup] gitleaks $required installed to $dest"
}

create_venv() {
  if [ -d "$VENV" ]; then
    echo "[setup] venv already at $VENV"
  else
    echo "[setup] creating venv at $VENV"
    "$PYTHON" -m venv "$VENV"
  fi
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
  python -m pip install --upgrade pip setuptools wheel
}

install_deps() {
  local req
  if [ -f "$ROOT/server/requirements.txt" ]; then
    req="$ROOT/server/requirements.txt"
  elif [ -f "$ROOT/requirements.txt" ]; then
    req="$ROOT/requirements.txt"
  else
    echo "[setup] ERROR: no requirements.txt found"; exit 1
  fi
  echo "[setup] installing $req"
  pip install -r "$req"
  pip install pre-commit
  pre-commit install
}

init_database() {
  echo "[setup] initializing SQLite database"
  python "$ROOT/scripts/init-db.py"
}

scaffold_env() {
  if [ -f "$ENV_FILE" ]; then
    echo "[setup] .env already present; not overwriting"
    return 0
  fi
  if [ ! -f "$ROOT/.env.example" ]; then
    echo "[setup] ERROR: .env.example missing"; exit 1
  fi
  cp "$ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "[setup] copied .env.example → .env"
}

scaffold_mc_config() {
  local target="$ROOT/config/mission-control.json"
  local example="$ROOT/config/mission-control.json.example"
  if [ -f "$target" ]; then
    echo "[setup] $target already present"
    return 0
  fi
  if [ ! -f "$example" ]; then
    echo "[setup] WARN: $example missing; skipping"
    return 0
  fi
  mkdir -p "$ROOT/config"
  cp "$example" "$target"
  echo "[setup] copied mission-control.json.example → mission-control.json"
}

# Fill BRIDGE_AUTH_TOKEN with a per-install random secret if blank.
# Idempotent — only writes when the line is `BRIDGE_AUTH_TOKEN=` (no value).
generate_secrets() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "[setup] WARN: .env missing; skipping secret generation"
    return 0
  fi
  if grep -qE '^BRIDGE_AUTH_TOKEN=.+' "$ENV_FILE"; then
    echo "[setup] BRIDGE_AUTH_TOKEN already set; not regenerating"
    return 0
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[setup] ERROR: openssl required to generate BRIDGE_AUTH_TOKEN"; exit 1
  fi
  local token; token="$(openssl rand -hex 32)"
  local tmp; tmp="$(mktemp)"
  awk -v t="$token" '/^BRIDGE_AUTH_TOKEN=$/ { print "BRIDGE_AUTH_TOKEN=" t; next } { print }' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "[setup] generated BRIDGE_AUTH_TOKEN (per-install secret)"
}

# Scaffold canvas dashboard config from .example, injecting the matching
# BRIDGE_AUTH_TOKEN so the dashboard can talk to the bridge server.
scaffold_canvas_mc_config() {
  local target="$ROOT/config/canvas/mission-control.json"
  local example="$ROOT/config/canvas/mission-control.json.example"
  if [ -f "$target" ]; then
    echo "[setup] $target already present"
    return 0
  fi
  if [ ! -f "$example" ]; then
    echo "[setup] WARN: $example missing; skipping canvas config"
    return 0
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "[setup] WARN: .env missing; skipping canvas config"
    return 0
  fi
  local token
  token="$(grep -E '^BRIDGE_AUTH_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  if [ -z "$token" ]; then
    echo "[setup] WARN: BRIDGE_AUTH_TOKEN empty in .env; canvas config will have blank token"
  fi
  mkdir -p "$ROOT/config/canvas"
  awk -v t="$token" '
    /"bridge_token"[[:space:]]*:[[:space:]]*""/ {
      sub(/"bridge_token"[[:space:]]*:[[:space:]]*""/, "\"bridge_token\": \"" t "\"")
    }
    { print }
  ' "$example" > "$target"
  chmod 600 "$target"
  echo "[setup] scaffolded canvas/mission-control.json with per-install bridge_token"
}

# ════════════════════════════════════════════════════════════════════════════
#  STAGE 2 — Interactive wizard
# ════════════════════════════════════════════════════════════════════════════

# ── Helpers ────────────────────────────────────────────────────────────────
env_get() {
  # If a key appears multiple times, take the last occurrence (matches shell
  # sourcing semantics: later assignments win).
  grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

env_set() {
  local key="$1" val="$2"
  local tmp; tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" \
      'BEGIN{p="^"k"="} $0 ~ p { print k"="v; next } { print }' \
      "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
    rm -f "$tmp"
  fi
  chmod 600 "$ENV_FILE"
}

mask() {
  local v="$1"
  if [ -z "$v" ]; then echo "(unset)"; return; fi
  local n=${#v}
  if [ "$n" -le 8 ]; then echo "***"; else echo "***${v: -4}"; fi
}

prompt_default() {
  local label="$1" current="$2" reply
  if [ -n "$current" ]; then
    read -r -p "  $label [$current]: " reply
    echo "${reply:-$current}"
  else
    read -r -p "  $label: " reply
    echo "$reply"
  fi
}

prompt_secret() {
  # Blank input keeps current (prevents fat-finger wipe).
  local label="$1" current="$2" reply
  local display; display="$(mask "$current")"
  read -r -s -p "  $label [$display]: " reply
  echo "" >&2
  echo "${reply:-$current}"
}

prompt_yn() {
  local q="$1" def="${2:-n}" reply hint
  if [ "$def" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  read -r -p "  $q $hint: " reply
  reply="${reply:-$def}"
  case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

retry_or_skip() {
  local reply
  while true; do
    read -r -p "  [r]etry / [s]kip / [a]bort: " reply
    case "$reply" in
      [Rr]*) echo "r"; return ;;
      [Ss]*) echo "s"; return ;;
      [Aa]*) echo "a"; return ;;
    esac
  done
}

abort_if() {
  if [ "$1" = "a" ]; then echo "[setup] aborted by user"; exit 1; fi
}

# 3s connect-timeout TCP probe. Python's socket.settimeout is the only
# portable way to bound TCP connect across macOS + Linux — `nc -w` on macOS
# is an idle timeout, not a connect timeout.
tcp_probe() {
  local host="$1" port="$2"
  "$PYTHON" - "$host" "$port" <<'PY' >/dev/null 2>&1
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(3)
try:
    s.connect((host, port))
    sys.exit(0)
except Exception:
    sys.exit(1)
finally:
    s.close()
PY
}

# HTTP probe: curl with 10s timeout, expect 2xx. Follows redirects (-L) and
# takes last 3 chars of %{http_code} to handle multi-response chains.
http_probe() {
  local url="$1"; shift
  local code
  code="$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 10 "$@" "$url" 2>/dev/null || echo 000)"
  code="${code: -3}"
  case "$code" in 2??) return 0 ;; *) echo "    HTTP $code" >&2; return 1 ;; esac
}

# Provider validators — each takes the key/host as $1.
validate_anthropic() {
  http_probe "https://api.anthropic.com/v1/models" \
    -H "x-api-key: $1" -H "anthropic-version: 2023-06-01"
}
validate_openai() {
  http_probe "https://api.openai.com/v1/models" -H "Authorization: Bearer $1"
}
validate_gemini() {
  http_probe "https://generativelanguage.googleapis.com/v1beta/models?key=$1"
}
validate_openrouter() {
  http_probe "https://openrouter.ai/api/v1/models" -H "Authorization: Bearer $1"
}
validate_ollama() {
  http_probe "${1%/}/api/tags"
}

PROVIDER_CONFIGURED=""
configure_provider() {
  # configure_provider "Display" ENV_VAR current validator is_url
  local name="$1" var="$2" current="$3" validator="$4" is_url="$5"
  echo "  → $name"
  while true; do
    local val
    if [ "$is_url" = "yes" ]; then
      val="$(prompt_default "${var}" "${current:-http://127.0.0.1:11434}")"
    else
      val="$(prompt_secret "${var}" "$current")"
    fi
    if [ -z "$val" ]; then
      echo "    (skipped)"
      return 1
    fi
    echo "    validating ..."
    if "$validator" "$val"; then
      env_set "$var" "$val"
      echo "    ✓ saved"
      PROVIDER_CONFIGURED="$PROVIDER_CONFIGURED $name"
      return 0
    else
      echo "    ✗ validation failed"
      local action; action="$(retry_or_skip)"; abort_if "$action"
      if [ "$action" = "s" ]; then return 1; fi
    fi
  done
}

# Path B/M only: detect agents whose model_pref targets a provider with no
# key, print the proposed sed diff, apply only on user confirmation.
retarget_agents() {
  [ "$PATH_CHOICE" = "A" ] && return 0
  [ -d "$AGENTS_DIR" ] || return 0

  local configured_lc=""
  [ -n "$(env_get ANTHROPIC_API_KEY)" ]   && configured_lc="$configured_lc anthropic"
  [ -n "$(env_get OPENAI_API_KEY)" ]      && configured_lc="$configured_lc openai"
  [ -n "$(env_get GEMINI_API_KEY)" ]      && configured_lc="$configured_lc gemini"
  [ -n "$(env_get OPENROUTER_API_KEY)" ]  && configured_lc="$configured_lc openrouter"
  [ -n "$(env_get OLLAMA_HOST)" ]         && configured_lc="$configured_lc ollama"
  [ -z "$configured_lc" ] && return 0

  local mismatched=""
  for f in "$AGENTS_DIR"/*.yml "$AGENTS_DIR"/*.yaml; do
    [ -f "$f" ] || continue
    local pref provider
    pref="$(grep -E '^model_pref:' "$f" | head -1 | sed -E 's/^model_pref:[[:space:]]*//;s/^["'"'"']//;s/["'"'"']$//')"
    [ -z "$pref" ] && continue
    provider="${pref%%/*}"
    case " $configured_lc " in
      *" $provider "*) ;;
      *) mismatched="$mismatched $f" ;;
    esac
  done
  [ -z "$mismatched" ] && return 0

  echo "─── Starter agents ────────────────────────────────────────────"
  echo ""
  echo "  These agents target a provider you didn't configure:"
  for f in $mismatched; do
    local pref; pref="$(grep -E '^model_pref:' "$f" | head -1)"
    echo "    $(basename "$f"):  $pref"
  done
  echo ""
  echo "  Configured providers (pick a target):"
  local i=0 options=""
  for p in $configured_lc; do
    i=$((i+1))
    local default_model
    case "$p" in
      anthropic)  default_model="claude-sonnet-4-6" ;;
      openai)     default_model="gpt-4o-mini" ;;
      gemini)     default_model="gemini-2.0-flash" ;;
      openrouter) default_model="anthropic/claude-sonnet-4-6" ;;
      ollama)     default_model="llama3.1" ;;
    esac
    echo "    [$i] $p/$default_model"
    options="$options $p|$default_model"
  done
  echo "    [0] leave as-is (edit YAML manually later)"
  echo ""
  local choice; read -r -p "  Pick [0-$i]: " choice
  choice="${choice:-0}"
  if [ "$choice" = "0" ] || ! [ "$choice" -ge 1 ] 2>/dev/null || [ "$choice" -gt "$i" ]; then
    SUM_RETARGET="(left as-is)"
    return 0
  fi
  local j=0 chosen=""
  for opt in $options; do
    j=$((j+1))
    [ "$j" = "$choice" ] && chosen="$opt" && break
  done
  local new_provider="${chosen%%|*}" new_model="${chosen#*|}"
  local new_pref="${new_provider}/${new_model}"

  echo ""
  echo "  Proposed change:"
  for f in $mismatched; do
    local old; old="$(grep -E '^model_pref:' "$f" | head -1)"
    echo "    $(basename "$f"):"
    echo "      -  $old"
    echo "      +  model_pref: $new_pref"
  done
  echo ""
  if prompt_yn "Apply?" "y"; then
    for f in $mismatched; do
      local tmp; tmp="$(mktemp)"
      awk -v new="$new_pref" '/^model_pref:/ { print "model_pref: " new; next } { print }' "$f" > "$tmp"
      mv "$tmp" "$f"
    done
    SUM_RETARGET="→ $new_pref"
    echo "  ✓ applied"
  else
    SUM_RETARGET="(declined)"
  fi
  echo ""
}

run_wizard() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "[setup] curl required for wizard" >&2; exit 1
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "[setup] .env missing — cannot run wizard" >&2; exit 1
  fi

  cat <<'EOF'

╔═══════════════════════════════════════════════════════════════╗
║  Mission Control — credentials wizard                         ║
╚═══════════════════════════════════════════════════════════════╝

Validates every key with a live ping; bad keys are not saved.
Re-run with --reconfigure anytime to change.

EOF

  local CUR_GW_URL CUR_GW_TOKEN CUR_ANTHROPIC CUR_OPENAI CUR_GEMINI
  local CUR_OPENROUTER CUR_OLLAMA_HOST CUR_DISCORD CUR_TELEGRAM
  local CUR_TG_DEFAULT CUR_TG_OPERATOR
  CUR_GW_URL="$(env_get OPENCLAW_GATEWAY_URL)"
  CUR_GW_TOKEN="$(env_get OPENCLAW_GATEWAY_TOKEN)"
  CUR_ANTHROPIC="$(env_get ANTHROPIC_API_KEY)"
  CUR_OPENAI="$(env_get OPENAI_API_KEY)"
  CUR_GEMINI="$(env_get GEMINI_API_KEY)"
  CUR_OPENROUTER="$(env_get OPENROUTER_API_KEY)"
  CUR_OLLAMA_HOST="$(env_get OLLAMA_HOST)"
  CUR_DISCORD="$(env_get DISCORD_BOT_TOKEN)"
  CUR_TELEGRAM="$(env_get TELEGRAM_BOT_TOKEN)"
  CUR_TG_DEFAULT="$(env_get TELEGRAM_DEFAULT_CHAT_ID)"
  CUR_TG_OPERATOR="$(env_get TELEGRAM_OPERATOR_CHAT_ID)"

  local has_path_a="no" has_path_b="no"
  [ -n "$CUR_GW_TOKEN" ] && has_path_a="yes"
  for v in "$CUR_ANTHROPIC" "$CUR_OPENAI" "$CUR_GEMINI" "$CUR_OPENROUTER"; do
    [ -n "$v" ] && has_path_b="yes" && break
  done

  if [ "$has_path_a" = "yes" ] || [ "$has_path_b" = "yes" ]; then
    echo "Current state:"
    echo "  Gateway (path A):    $has_path_a"
    echo "  Direct SDK (path B): $has_path_b"
    echo ""
    prompt_yn "Reconfigure?" "y" || { echo "[setup] no changes made"; return 0; }
    echo ""
  fi

  # ── A/B/M gate ───────────────────────────────────────────────────────────
  cat <<'EOF'
─── How should agents reach models? ────────────────────────────

  [A] OpenClaw gateway  — recommended; works with Claude Pro /
                          ChatGPT OAuth (no API key in this repo)
  [B] Direct SDK        — simplest; requires provider API keys
  [M] Mixed             — advanced; configure both, pick per-call

EOF
  PATH_CHOICE=""
  while [ -z "$PATH_CHOICE" ]; do
    read -r -p "  Choice [A/B/M]: " reply
    reply="${reply:-A}"
    case "$reply" in
      [Aa]) PATH_CHOICE="A" ;;
      [Bb]) PATH_CHOICE="B" ;;
      [Mm]) PATH_CHOICE="M" ;;
      *) echo "    pick A, B, or M" ;;
    esac
  done
  echo ""

  local SUM_PATH="$PATH_CHOICE" SUM_GATEWAY="" SUM_PROVIDERS=""
  SUM_RETARGET=""  # consumed by retarget_agents (defined outside)
  local SUM_INTEGRATIONS=""

  # ── Gateway (A, M) ───────────────────────────────────────────────────────
  if [ "$PATH_CHOICE" = "A" ] || [ "$PATH_CHOICE" = "M" ]; then
    echo "─── OpenClaw gateway ──────────────────────────────────────────"
    echo ""
    : "${CUR_GW_URL:=ws://127.0.0.1:18789}"

    while true; do
      local GW_URL GW_TOKEN
      GW_URL="$(prompt_default "Gateway URL" "$CUR_GW_URL")"
      GW_TOKEN="$(prompt_secret "Gateway token (bearer)" "$CUR_GW_TOKEN")"
      if [ -z "$GW_TOKEN" ]; then
        echo "    token required for path A; cannot be blank"
        action="$(retry_or_skip)"; abort_if "$action"
        [ "$action" = "s" ] && break
        continue
      fi

      local host_port host port
      host_port="${GW_URL#ws://}"; host_port="${host_port#wss://}"
      host_port="${host_port%%/*}"
      host="${host_port%:*}"
      port="${host_port##*:}"
      if [ "$host" = "$port" ] || [ -z "$port" ]; then port="80"; fi

      echo "    probing tcp://${host}:${port} ..."
      if tcp_probe "$host" "$port"; then
        env_set OPENCLAW_GATEWAY_URL "$GW_URL"
        env_set OPENCLAW_GATEWAY_TOKEN "$GW_TOKEN"
        echo "    ✓ gateway reachable; saved"
        SUM_GATEWAY="$GW_URL (validated)"
        break
      else
        echo "    ✗ cannot reach ${host}:${port}"
        action="$(retry_or_skip)"; abort_if "$action"
        if [ "$action" = "s" ]; then
          SUM_GATEWAY="(skipped — unreachable)"
          break
        fi
      fi
    done
    echo ""
  fi

  # ── Providers (B, M) ─────────────────────────────────────────────────────
  if [ "$PATH_CHOICE" = "B" ] || [ "$PATH_CHOICE" = "M" ]; then
    while true; do
      echo "─── Provider API keys ─────────────────────────────────────────"
      echo "  Blank input = skip. Enter on a set value = keep it."
      echo ""
      PROVIDER_CONFIGURED=""
      configure_provider "Anthropic"   ANTHROPIC_API_KEY   "$CUR_ANTHROPIC"   validate_anthropic   no  || true
      configure_provider "OpenAI"      OPENAI_API_KEY      "$CUR_OPENAI"      validate_openai      no  || true
      configure_provider "Gemini"      GEMINI_API_KEY      "$CUR_GEMINI"      validate_gemini      no  || true
      configure_provider "OpenRouter"  OPENROUTER_API_KEY  "$CUR_OPENROUTER"  validate_openrouter  no  || true
      configure_provider "Ollama"      OLLAMA_HOST         "$CUR_OLLAMA_HOST" validate_ollama      yes || true
      echo ""

      if [ "$PATH_CHOICE" = "B" ] && [ -z "$PROVIDER_CONFIGURED" ]; then
        echo "  path B requires at least one provider — try again."
        echo ""
        continue
      fi
      SUM_PROVIDERS="${PROVIDER_CONFIGURED## }"
      [ -z "$SUM_PROVIDERS" ] && SUM_PROVIDERS="(none configured)"
      break
    done
  fi

  # ── Retarget starter agents (B, M only) ──────────────────────────────────
  retarget_agents

  # ── Integrations (optional) ──────────────────────────────────────────────
  echo "─── Outbound integrations ─────────────────────────────────────"
  echo ""
  if prompt_yn "Configure Discord / Telegram now?" "n"; then
    echo ""
    while true; do
      local DC_TOKEN
      DC_TOKEN="$(prompt_secret "Discord bot token" "$CUR_DISCORD")"
      if [ -z "$DC_TOKEN" ]; then echo "    (Discord skipped)"; break; fi
      echo "    validating ..."
      if http_probe "https://discord.com/api/v10/users/@me" -H "Authorization: Bot $DC_TOKEN"; then
        env_set DISCORD_BOT_TOKEN "$DC_TOKEN"
        SUM_INTEGRATIONS="${SUM_INTEGRATIONS}discord "
        echo "    ✓ saved"
        break
      else
        echo "    ✗ validation failed"
        action="$(retry_or_skip)"; abort_if "$action"
        [ "$action" = "s" ] && break
      fi
    done

    while true; do
      local TG_TOKEN
      TG_TOKEN="$(prompt_secret "Telegram bot token" "$CUR_TELEGRAM")"
      if [ -z "$TG_TOKEN" ]; then echo "    (Telegram skipped)"; break; fi
      echo "    validating ..."
      if http_probe "https://api.telegram.org/bot${TG_TOKEN}/getMe"; then
        env_set TELEGRAM_BOT_TOKEN "$TG_TOKEN"
        SUM_INTEGRATIONS="${SUM_INTEGRATIONS}telegram "
        echo "    ✓ saved"

        local TG_DEFAULT TG_OPERATOR
        TG_DEFAULT="$(prompt_default "TELEGRAM_DEFAULT_CHAT_ID (optional)" "$CUR_TG_DEFAULT")"
        [ -n "$TG_DEFAULT" ] && env_set TELEGRAM_DEFAULT_CHAT_ID "$TG_DEFAULT"
        TG_OPERATOR="$(prompt_default "TELEGRAM_OPERATOR_CHAT_ID (optional)" "$CUR_TG_OPERATOR")"
        [ -n "$TG_OPERATOR" ] && env_set TELEGRAM_OPERATOR_CHAT_ID "$TG_OPERATOR"
        break
      else
        echo "    ✗ validation failed"
        action="$(retry_or_skip)"; abort_if "$action"
        [ "$action" = "s" ] && break
      fi
    done
  fi
  SUM_INTEGRATIONS="${SUM_INTEGRATIONS:-none}"
  echo ""

  # ── Summary ──────────────────────────────────────────────────────────────
  cat <<EOF
╔═══════════════════════════════════════════════════════════════╗
║  Setup complete                                               ║
╚═══════════════════════════════════════════════════════════════╝

  Path:           $SUM_PATH
  Gateway:        ${SUM_GATEWAY:-n/a}
  Providers:      ${SUM_PROVIDERS:-n/a}
  Starter agents: ${SUM_RETARGET:-(no changes)}
  Integrations:   $SUM_INTEGRATIONS

EOF
  if [ "$PATH_CHOICE" = "B" ]; then
    echo "  Mixed mode: re-run ./setup.sh --reconfigure and pick [M] to also wire the gateway."
  elif [ "$PATH_CHOICE" = "A" ]; then
    echo "  Mixed mode: re-run ./setup.sh --reconfigure and pick [M] to also wire direct SDK keys."
  fi
  echo ""
  echo "  Launch:  ./mission-control.sh"
  echo ""
}

# ── main ───────────────────────────────────────────────────────────────────
main() {
  if [ "$RUN_BOOTSTRAP" = "yes" ]; then
    install_gitleaks
    create_venv
    install_deps
    init_database
    scaffold_env
    generate_secrets
    scaffold_mc_config
    scaffold_canvas_mc_config
  else
    if [ ! -f "$ENV_FILE" ]; then
      echo "[setup] --reconfigure requires a prior successful run (.env missing)" >&2
      exit 1
    fi
    echo "[setup] --reconfigure: skipping mechanical bootstrap"
  fi

  if [ "$RUN_WIZARD" = "yes" ]; then
    run_wizard
  else
    echo ""
    echo "[setup] DONE. Next: edit .env (or run ./setup.sh --reconfigure), then ./mission-control.sh"
  fi
}
main
