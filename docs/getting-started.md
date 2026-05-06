# Getting Started

Mission Control gets you to a working agent dashboard in under 10 minutes.

## 1. Prerequisites

- macOS 13+ or Linux (any distro). **Windows: use WSL2.**
- Python 3.11 or 3.12 (`python3 --version`)
- Git
- `curl` and `tar` (preinstalled on macOS/Linux)
- At least one model-provider API key (Anthropic, OpenAI, Gemini, or OpenRouter) **OR** a local Ollama install

## 2. Clone & bootstrap

```bash
git clone <repo-url> mission-control
cd mission-control
./bootstrap.sh
```

`bootstrap.sh` will:

1. Install `gitleaks v8.30.1` to `~/.local/bin` (skipped if already present at the pinned version)
2. Create a Python venv at `.venv/`
3. Install Python dependencies + the `pre-commit` framework
4. Initialize the SQLite database at `config/canvas/mission-control.db`
5. Copy `.env.example` → `.env` (mode `600`)
6. Copy `config/mission-control.json.example` → `config/mission-control.json`
7. Install the gitleaks pre-commit hook

Add `~/.local/bin` to your `PATH` if `bootstrap.sh` prints a warning:

```bash
export PATH="$HOME/.local/bin:$PATH"   # add to ~/.zshrc or ~/.bashrc
```

## 3. Configure

Edit `.env` and fill in **at minimum**:

- `BRIDGE_AUTH_TOKEN` — generate with `openssl rand -hex 32`
- One of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY`
  (or set `OLLAMA_BASE_URL` to a reachable Ollama instance)

Optional integrations:

- `DISCORD_BOT_TOKEN` — for Discord posting
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_DEFAULT_CHAT_ID` — for Telegram posting

See [adding-an-integration.md](./adding-an-integration.md) for the full list of
optional integrations and their env vars.

See [adding-an-agent.md](./adding-an-agent.md) to define your first agent.

## 4. Launch

```bash
./mission-control.sh
```

This starts the FastAPI bridge on `http://127.0.0.1:8100/` and opens your default
browser at `http://127.0.0.1:8100/dashboard/`. The EVA-themed dashboard loads with
the agent panel populated from `config/agents/*.yml`.

Stop with `Ctrl-C`.

## 5. Verify it works

- Browser shows the EVA-themed dashboard (orange-on-black CRT theme)
- Agent panel lists at least one agent (the starter agents shipped in `config/agents/`)
- The terminal panel accepts text input

## 6. Troubleshoot

| Symptom | Fix |
|---|---|
| `gitleaks: command not found` after bootstrap | Add `~/.local/bin` to `$PATH` (see step 2) |
| `bootstrap.sh` fails on `pip install` | Ensure Python ≥ 3.11; on Linux you may need `python3-venv` (`sudo apt install python3.12-venv`) |
| Dashboard doesn't open | Open `http://127.0.0.1:8100/dashboard/` manually; check `BRIDGE_HOST` / `BRIDGE_PORT` in `.env` |
| Empty agent panel | Confirm `config/agents/*.yml` exists; see [adding-an-agent.md](./adding-an-agent.md) |
| `ANTHROPIC_API_KEY not set` (or similar) in logs | Edit `.env`, add the key, restart `./mission-control.sh` |
| Pre-commit hook blocks a real commit on a false-positive | Add the fingerprint to `.gitleaksignore` (format documented in the file's header) |

## Next steps

- [Add an agent](./adding-an-agent.md)
- [Add a model provider](./adding-a-model-provider.md)
- [Add an integration](./adding-an-integration.md)
- [Architecture overview](./architecture.md)
