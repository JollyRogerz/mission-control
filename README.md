# Mission Control

> A self-hosted, EVA-themed agent dashboard for orchestrating LLM-powered swarms.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Python](https://img.shields.io/badge/python-3.11%2B-blue.svg)
![Status](https://img.shields.io/badge/status-alpha-orange.svg)

![EVA-themed dashboard](docs/images/eva-theme.png)

Mission Control is a vanilla-JS + FastAPI dashboard that lets you run a swarm of LLM agents
with pluggable model providers (Anthropic, OpenAI, Gemini, OpenRouter, Ollama) and pluggable
integrations (Discord, Telegram). Agents are defined in YAML; providers and integrations are
drop-in Python adapters. Everything runs locally — your keys, your data, your agents.

## Quickstart

Requires Python 3.11+ on macOS or Linux (Windows: use WSL2).

```bash
git clone <repo-url> mission-control
cd mission-control
./bootstrap.sh
# edit .env to add at least BRIDGE_AUTH_TOKEN and one provider key
./mission-control.sh
```

Browser opens at `http://127.0.0.1:8100/` with the EVA-themed dashboard.

Full guide: **[docs/getting-started.md](docs/getting-started.md)**

## Documentation

- [Getting started](docs/getting-started.md) — install, configure, launch
- [Add an agent](docs/adding-an-agent.md) — YAML schema for agent definitions
- [Add a model provider](docs/adding-a-model-provider.md) — write a custom LLM adapter
- [Add an integration](docs/adding-an-integration.md) — write a custom outbound channel adapter
- [Architecture](docs/architecture.md) — adapter Protocols, runtime flow, schema reference

## Status

**Alpha.** APIs and the YAML schema may change between minor versions. Production use
requires you to vet the adapter code paths for your stack and rotate `BRIDGE_AUTH_TOKEN`
on a schedule appropriate to your threat model.

## License

[MIT](LICENSE) © 2026 Mission Control Contributors
