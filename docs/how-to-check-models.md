# 🦞 How to Check Which Model Was Used — Automatic Tracking

## TL;DR — It's Automatic Now!

Every time OpenRouter Auto picks a model for you, the proxy **automatically**:
1. Captures the generation ID from the response
2. Fetches the full metadata from OpenRouter
3. Writes it to two files you can always read

**No manual steps needed. No generation IDs to share.**

---

## Where to Read the Data

### Latest model used (always current):
```
memory/last-model-used.json
```

Example:
```json
{
  "timestamp": "2026-02-03T20:07:09.898Z",
  "generation_id": "gen-1770149223-8b5fGjbzGp7gGquv47DI",
  "model": "mistralai/mistral-nemo",
  "router": "openrouter/auto",
  "cost": 0.02007834,
  "tokens_prompt": 3651,
  "tokens_completion": 2,
  "latency": 434,
  "provider_name": "DeepInfra",
  "failures": []
}
```

### Full history (all generations):
```
logs/model-tracking.jsonl
```
One JSON object per line, newest at the bottom.

---

## What the Fields Mean

| Field | What it tells you |
|-------|-------------------|
| `model` | The model OpenRouter Auto actually selected |
| `router` | `openrouter/auto` = auto-routed, `direct` = specific model |
| `cost` | Total cost in USD for this generation |
| `tokens_prompt` | How many prompt tokens were sent |
| `tokens_completion` | How many completion tokens came back |
| `latency` | Response time in milliseconds |
| `provider_name` | Which provider hosted the model (e.g., DeepInfra, Azure) |
| `failures` | Array of models that FAILED before success |

---

## Failure Details

When `failures` is not empty, it means OpenRouter tried other models first:
```json
"failures": [
  { "provider": "Mistral", "model": "mistralai/mistral-nemo", "status": 400 },
  { "provider": "Azure", "model": "mistralai/mistral-nemo", "status": 422 }
]
```

Common status codes:
- **400** Bad Request — model couldn't handle the prompt format
- **422** Unprocessable — content type issue
- **429** Rate Limited — provider was overloaded
- **503** Service Unavailable — provider was down

---

## How It Works (Under the Hood)

```
OpenClaw → local proxy (port 3939) → OpenRouter → model provider
                ↓
        captures gen ID from response
                ↓
        fetches metadata via /api/v1/generation
                ↓
        writes to memory/last-model-used.json
        appends to logs/model-tracking.jsonl
```

The proxy runs automatically in the background inside the container.
Restart it if needed: `node scripts/openrouter-proxy.js`

---

## Manual Check (Backup)

If you have a specific generation ID and want to check it manually:
```bash
scripts/get-openrouter-model.sh gen-XXXXX-XXXXX
```

---

## Tips

- Read `memory/last-model-used.json` AFTER each task completes to report which model was used
- Track patterns in `memory/openrouter-model-performance.md` — which models work best for what
- If `failures` array has entries, note what failed and why — helps optimize routing
