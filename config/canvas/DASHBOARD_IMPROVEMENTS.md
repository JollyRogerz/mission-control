# Mission Control — Context & Improvement Plan

## What Was Built (Previous Sessions)

### System Architecture

The Mission Control is a real-time dashboard for monitoring and interacting with OpenClaw's multi-agent system. It consists of:

```
Telegram → Bridge Server (getUpdates polling) → Classifier → ONE agent via Gateway
                ↓                                                    ↓
         Mission Control ←──── WebSocket events ←──── Gateway (Docker)
```

**Key Components:**
- **Bridge Server** (`openclaw-vtuber/server/bridge_server.py`) — Python/FastAPI server on port 8100. Connects to OpenClaw Gateway WebSocket, handles Telegram messages, serves Mission Control dashboard, routes messages to agents.
- **Mission Control Desktop App** (`config/canvas/app.py`) — Python pywebview wrapper that auto-discovers auth tokens and opens the dashboard in a native window.
- **Dashboard Frontend** (`config/canvas/index.html`, `terminal.js`, `terminal.css`, `sprites.css`, `grid.js`) — Pure vanilla JS SPA with pixel art sprites, real-time WebSocket event handling, and draggable panel layout.

### What Was Implemented

#### 1. Telegram Direct Handling (Bridge as Sole Handler)
- **Disabled Docker's built-in Telegram integration** (`config/openclaw.json`: `channels.telegram.enabled: false`)
- **Bridge polls Telegram via `getUpdates` API** — replaces old `telegram_session_watcher()` that polled Docker session files via `docker exec tail`
- **Eliminates duplicate execution** — previously both Orchestrator (via Docker) AND a specialist (via bridge) would execute the same Telegram message
- **Offset seeding on startup** — does `getUpdates` with `offset=-1` to skip old messages on restart

#### 2. Message Classification & Routing
- **Keyword-based classifier** (`_classify_message()`) with regex patterns:
  - `_BUILDER_KEYWORDS`: pr, git, code, build, test, deploy, npm, docker, sweep, etc.
  - `_ARCHITECT_KEYWORDS`: architecture, security, audit, design, plan, schema, etc.
  - `_SOCIAL_KEYWORDS`: post, tweet, social, announce, blog, newsletter, etc.
- **Scoring**: counts keyword matches per specialist, highest wins (must be clear winner)
- **Routes via gateway**: `send_chat_via_gateway(text, "agent:<agentId>:main")`

#### 3. Conversation Memory (Follow-up Routing)
- **`_tg_conversation` dict** tracks the last agent that handled a Telegram message
- **5-minute TTL** (`CONVERSATION_TTL_SEC = 300`)
- **Ambiguous follow-ups** like "yes pls do", "go ahead", "ok" route back to the same agent instead of falling through to Orchestrator
- **Refreshed on agent response** — lifecycle "end" handler updates the memory when an agent finishes, keeping the conversation warm
- **Keyword matches always override** — a clear specialist match starts a new conversation regardless of memory

#### 4. Response Forwarding to Telegram
- **`_pending_forward_sessions` / `_forward_run_ids`** — session-key-specific tracking ensures only the target agent's lifecycle events trigger forwarding
- **`_forward_response_to_telegram()`** — sends agent response to Telegram with emoji + name prefix (e.g., "🦞 *Builder*")
- **`sendMessageDraft` streaming** with 1.0s throttle to prevent Telegram 429 rate limits
- **Draft cleanup** on lifecycle "end"

#### 5. Mission Control Frontend
- **4 agent cards** with pixel art sprites (Orchestrator, Builder, Architect, Social)
- **Activity feed** with timestamped, color-coded entries + raw log tab
- **Chat panel** with agent selector dropdown, markdown support, deduplication
- **Draggable/resizable panels** via grid.js with localStorage persistence
- **Auto-reconnect** WebSocket with 3s delay
- **Bridge health check** every 10s, ping every 25s

#### 6. MC Dropdown → Agent Routing
- Frontend sends `target_agent` field in POST `/api/chat`
- Bridge builds `session_key = "agent:<agentId>:main"` and routes via gateway
- **Auto-classify mode** — when "Auto" is selected, bridge classifies the message itself
- Routing events pushed to MC dashboard for visual feedback

### Key Files

| File | Purpose |
|------|---------|
| `openclaw-vtuber/server/bridge_server.py` | Bridge server — gateway connection, Telegram handling, API endpoints, event routing |
| `config/canvas/index.html` | Dashboard HTML structure (6 panels + auth modal) |
| `config/canvas/terminal.js` | Main dashboard JS (MissionControl class, ~1160 lines) |
| `config/canvas/terminal.css` | All dashboard styling (~725 lines) |
| `config/canvas/sprites.css` | Pixel art CSS box-shadow sprites (~985 lines) |
| `config/canvas/grid.js` | Panel drag/resize manager (~245 lines) |
| `config/canvas/app.py` | Python pywebview desktop wrapper (~260 lines) |
| `config/canvas/mission-control.json` | Config (bridge_token, etc.) |
| `config/openclaw.json` | Docker/gateway config (Telegram disabled, agent models, auth) |

### Gateway Protocol
- WebSocket at `ws://127.0.0.1:18789`
- Handshake: `connect.challenge` → `req/connect` (protocol 3)
- Auth token from `openclaw.json → gateway.auth.token`
- Client ID: must be one of `gateway-client`, `webchat-ui`, `openclaw-control-ui`, `cli`, etc.
- Events: `agent` (state/lifecycle/streaming), `chat`, `health`, `heartbeat`, `routing`
- Session keys: `"main"` = Orchestrator, `"agent:<id>:main"` = specific agent

### Known Issue: Model Failure
- Orchestrator's primary model `openai-codex/gpt-5.3-codex` times out (provider not properly defined in config)
- Fallback `deepseek/deepseek-r1-0528:free` returns 404 — OpenRouter no longer has the `:free` endpoint
- Fix: update model IDs in `openclaw.json` agents section (remove `:free` suffix or point to valid models)

---

## Dashboard Improvement Plan

### UX Polish

1. **Chat loading state** — No spinner or "sending..." when you hit Send. You can double-send before the first response arrives. Add disabled state + spinner on the send button while waiting for POST response. Re-enable on success/error.

2. **Truncated feed entries** — Long messages cut off with `...` but no tooltip on hover to see the full text. Add `title` attribute or a hover popover showing the full entry text.

3. **Connection status unclear** — Two dots (Gateway/Bridge) but if one is up and the other down, it's confusing what still works. Add tooltip explaining each: "Bridge: HTTP/WS connection to bridge_server.py", "Gateway: OpenClaw Docker gateway via bridge relay". Show explicit "connected/disconnected/reconnecting" text on hover.

4. **Agent "starting"/"stopping" states** — CSS classes `.state-starting` and `.state-stopping` are defined but have no animation, so they look identical to idle. Add distinct animations (e.g., starting = fade-in pulse, stopping = fade-out).

### Missing Features

5. **Agent filter in activity feed** — Can't filter to see only Builder or only Orchestrator events. Gets noisy fast. Add clickable agent name chips above the feed that toggle visibility per agent. Clicking "Builder" shows only Builder events.

6. **Keyboard shortcuts** — No Cmd+K for chat focus, no hotkeys for switching tabs. Add: Cmd+K = focus chat input, Cmd+1/2/3 = switch feed/raw/chat tabs, Escape = blur input.

7. **Heartbeat display** — Per-agent "last seen: 3s ago" would show if an agent is truly alive vs stale. The bridge already sends heartbeat events with agent info. Display the elapsed time since last heartbeat in each agent card.

8. **Chat history export** — No way to save a session's conversation. Add an export button (top of chat panel) that downloads chat messages as JSON or Markdown file.

9. **Log search regex** — Only case-insensitive string match, no regex or "match case" toggle. Add a small toggle icon next to the search input for regex mode. When enabled, treat the search string as a regex pattern.

10. **Monitor screen animation** — The pixel art monitors show static content. Could animate per state (code scrolling when tool_running, blinking cursor when thinking, error symbol on error, checkmark on completed). This is purely CSS — add keyframes that shift the box-shadow pixel art per state.

### Code Quality

11. **No input length limit on chat** — could send massive messages. Add `maxlength="5000"` to the chat input and show a character count near the send button.

12. **Hardcoded URLs** (`127.0.0.1:8100`, `:18789`) in JS — should come from config. Create a `CONFIG` object at the top of terminal.js that reads from `mission-control.json` or the pywebview API, with hardcoded defaults as fallback.

13. **MissionControl class is 1160 lines** — could split into modules. Consider splitting into: `EventHandler.js` (WebSocket message routing), `ChatManager.js` (chat panel logic), `AgentPanel.js` (agent card updates), `FeedManager.js` (activity feed). Import via ES modules or concatenate in build.

14. **Max 100 chat / 200 feed entries** — low for long sessions, no "load more" option. Increase defaults (500 chat, 1000 feed) and add a "Load earlier messages" button at the top of each panel that restores from a larger in-memory buffer.

### Quick Wins

15. **Tooltip on agent state badge** — explain what "thinking" vs "tool_running" means. Add `title` attributes: thinking = "Agent is reasoning about the task", tool_running = "Agent is executing a tool (shell, file edit, etc.)", speaking = "Agent is generating a response", error = "Agent encountered an error", idle = "Agent is waiting for a task".

16. **Notification sound** — optional ping when an agent finishes a task. Add a small speaker icon toggle in the header. When enabled, play a short notification sound (Web Audio API beep, no external file needed) on lifecycle "end" events.

17. **Message timestamps in chat** — currently no time shown on messages. Add a small `HH:MM` timestamp to the right of each chat bubble. Use the event's `ts` field or `new Date()` for user messages.

18. **Agent name on chat messages** — shows agent color but not which agent said what. Prepend agent name + emoji above each agent message bubble: "🦞 Builder", "🎯 Orchestrator", etc. Use the same `_AGENT_DISPLAY` mapping from the bridge.

---

## Running the System

```bash
# Start bridge server (handles gateway, Telegram, MC WebSocket)
cd openclaw-vtuber/server
PYTHONUNBUFFERED=1 .venv/bin/python bridge_server.py > /tmp/bridge.log 2>&1 &

# Start Mission Control desktop app
cd config/canvas
.venv/bin/python app.py > /tmp/mission_control.log 2>&1 &

# Check bridge logs
tail -f /tmp/bridge.log | grep -v "Expression sent"

# Kill and restart bridge
lsof -ti:8100 | xargs kill -9

# Restart Docker (if needed)
docker restart openclaw-horizon
```

**Auth tokens:**
- Bridge token: from `config/canvas/mission-control.json` → `bridge_token`
- Gateway token: from `config/openclaw.json` → `gateway.auth.token`
- Telegram bot token: from `.env` → `TELEGRAM_BOT_TOKEN`
