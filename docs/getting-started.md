# Getting Started

Mission Control gets you to a working agent dashboard in under 10 minutes.

## 1. Prerequisites

- macOS 13+ or Linux (any distro). **Windows: use WSL2.**
- Python 3.11 or 3.12 (`python3 --version`)
- Git
- `curl` and `tar` (preinstalled on macOS/Linux)
- At least one model-provider API key (Anthropic, OpenAI, Gemini, or OpenRouter) **OR** a local Ollama install

## 2. Clone & set up

```bash
git clone <repo-url> mission-control
cd mission-control
./setup.sh
```

`setup.sh` will:

1. Install `gitleaks v8.30.1` to `~/.local/bin` (skipped if already present at the pinned version)
2. Create a Python venv at `.venv/`
3. Install Python dependencies + the `pre-commit` framework
4. Initialize the SQLite database at `config/canvas/mission-control.db`
5. Copy `.env.example` → `.env` (mode `600`)
6. Copy `config/mission-control.json.example` → `config/mission-control.json`
7. Generate a per-install `BRIDGE_AUTH_TOKEN` and scaffold the canvas config
8. Install the gitleaks pre-commit hook
9. Launch the **interactive credentials wizard** (next section)

Add `~/.local/bin` to your `PATH` if `setup.sh` prints a warning:

```bash
export PATH="$HOME/.local/bin:$PATH"   # add to ~/.zshrc or ~/.bashrc
```

## 3. Configure (wizard)

At the end of `setup.sh`, the wizard walks you through credentials. It hard-fails on validation — bad keys are never written to `.env`.

**Step 1 — pick a path:**

- **[A] OpenClaw gateway** *(recommended)* — works with Claude Pro / ChatGPT OAuth accounts. The wizard probes the WebSocket port; saves the URL + token only if reachable.
- **[B] Direct SDK** — paste keys for any of Anthropic, OpenAI, Gemini, OpenRouter, or Ollama. Each key is live-validated against the provider's API. Path B requires ≥ 1 provider.
- **[M] Mixed** — both, for power users.

**Step 2 — starter-agent retarget (path B/M only):** if `config/agents/*.yml` points at a provider you didn't configure, the wizard prints a sed-style diff and asks for confirmation before retargeting.

**Step 3 — optional integrations:** Discord bot token (validated via `users/@me`) and Telegram bot token (validated via `getMe`). Skip with Enter on a blank prompt.

**Re-run anytime** to reconfigure without redoing the mechanical bootstrap:

```bash
./setup.sh --reconfigure
```

The wizard detects existing values and offers to keep them (Enter) or overwrite (paste a new value). Secrets are masked to last-4 on display. You can also skip the wizard entirely with `./setup.sh --no-wizard` and edit `.env` by hand.

See [adding-an-integration.md](./adding-an-integration.md) for integrations you might add later, and [adding-an-agent.md](./adding-an-agent.md) to define your own agent.

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
| `gitleaks: command not found` after setup | Add `~/.local/bin` to `$PATH` (see step 2) |
| `setup.sh` fails on `pip install` | Ensure Python ≥ 3.11; on Linux you may need `python3-venv` (`sudo apt install python3.12-venv`) |
| Dashboard doesn't open | Open `http://127.0.0.1:8100/dashboard/` manually; check `BRIDGE_HOST` / `BRIDGE_PORT` in `.env` |
| Empty agent panel | Confirm `config/agents/*.yml` exists; see [adding-an-agent.md](./adding-an-agent.md) |
| `ANTHROPIC_API_KEY not set` (or similar) in logs | Edit `.env`, add the key, restart `./mission-control.sh` |
| Pre-commit hook blocks a real commit on a false-positive | Add the fingerprint to `.gitleaksignore` (format documented in the file's header) |

## Next steps

- [Add an agent](./adding-an-agent.md)
- [Add a model provider](./adding-a-model-provider.md)
- [Add an integration](./adding-an-integration.md)
- [Architecture overview](./architecture.md)
