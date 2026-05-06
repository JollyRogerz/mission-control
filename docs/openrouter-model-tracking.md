# 📊 OpenRouter Auto Model Selection - How to Track

## 🎯 What You Want:

Your Horizon Builder agent to tell you:
1. **Which model OpenRouter Auto selected** for each request
2. **Why some models failed** before the successful one

## ✅ Good News - This Data is Available!

Based on your metadata example, OpenRouter provides comprehensive information about:
- Which model was ultimately used
- Which models were tried but failed
- Why they failed (status codes)
- Latency for each attempt

---

## 📋 Understanding Your Metadata

### Your Example Request:

```json
{
  "model": "google/gemini-2.5-flash-lite",  // ← Final model used
  "router": "openrouter/auto",              // ← Auto-routing was used
  "provider_responses": [                   // ← All attempts
    {
      "status": 400,                        // ← Failed: Bad Request
      "provider_name": "Mistral",
      "model_permaslug": "mistralai/mistral-nemo",
      "latency": 765
    },
    {
      "status": 422,                        // ← Failed: Unprocessable Entity
      "provider_name": "Azure",
      "model_permaslug": "mistralai/mistral-nemo",
      "latency": 338
    },
    {
      "status": 200,                        // ← Success!
      "provider_name": "Google",
      "model_permaslug": "google/gemini-2.5-flash-lite",
      "latency": 4524
    }
  ]
}
```

### What Happened:

1. **Attempt 1:** Mistral Nemo → Failed (400 - Bad Request) after 765ms
2. **Attempt 2:** Azure/Mistral Nemo → Failed (422 - Unprocessable) after 338ms  
3. **Attempt 3:** Google Gemini 2.5 Flash Lite → Success (200) after 4524ms

**Total routing time:** ~5.6 seconds across 3 attempts

---

## 🔍 Common Failure Reasons:

| Status | Meaning | Why It Failed |
|--------|---------|---------------|
| **400** | Bad Request | Request format issue, incompatible parameters |
| **422** | Unprocessable Entity | Model can't handle the specific prompt/parameters |
| **429** | Rate Limited | Provider hit rate limit |
| **500** | Server Error | Provider's model is down |
| **503** | Service Unavailable | Provider temporarily offline |

---

## 💡 How OpenClaw Can Report This

### Option 1: Add to Agent's SOUL.md

Update your agent to automatically report model selection after complex tasks:

```markdown
## Model Usage Transparency

After completing significant work (analysis, code generation, research):
- Report which model was used
- Note if fallbacks occurred
- Explain why (if known from metadata)

Example: "Used Google Gemini 2.5 Flash Lite for this analysis 
(Mistral Nemo failed due to request incompatibility)"
```

### Option 2: Create a Custom Skill

Create `/home/node/.openclaw/workspace/skills/openrouter-stats/SKILL.md`:

```bash
# OpenRouter Stats Skill

Check OpenRouter activity and report model usage.

## Usage:
"Show me my OpenRouter usage today"
"Which models were used in the last hour?"
"Why did OpenRouter fail to use X model?"

## Actions:
1. Fetch activity from openrouter.ai/activity
2. Parse generation metadata
3. Report models used and any failures
```

### Option 3: Add to Heartbeat Checks

Update `HEARTBEAT.md` to include OpenRouter monitoring:

```markdown
## 💰 Cost & Model Monitoring

Every few heartbeats:
- Check OpenRouter activity log
- Report unusual model selections
- Alert on high failure rates
- Track cost vs model usage
```

---

## 🚀 Implementation for Your Agent

### Tell Your Agent on Telegram:

```
I want you to start reporting which model OpenRouter Auto selected 
after you complete significant work.

When you finish a task, include a footer like:
"[Model: google/gemini-2.5-flash-lite via OpenRouter Auto]"

If there were failures before success, mention them:
"[Model: gemini-2.5-flash-lite after 2 failed attempts: 
mistral-nemo (400), azure/mistral-nemo (422)]"

This helps me understand:
1. What models are working well for different tasks
2. Which models are failing and why
3. How routing is performing

Update your working style to include this transparency.
```

---

## 📊 Interpreting Your Example

**What Your Metadata Shows:**

```
Task: McDonald's Portugal research
Routing: openrouter/auto
Attempts:
  ❌ Mistral Nemo → 400 (Bad Request) - 765ms
  ❌ Azure/Mistral Nemo → 422 (Unprocessable) - 338ms
  ✅ Gemini 2.5 Flash Lite → 200 (Success) - 4524ms

Result: Successful with Gemini after 2 failures
Total Time: ~5.6 seconds
Tokens: 71,079 prompt / 342 completion
Cost: $0.028 total ($0.02 for web search + $0.008 inference)
```

**Why Mistral Failed:**
- **400** = Bad request format (likely your prompt had parameters Mistral couldn't handle)
- **422** = Azure's Mistral endpoint couldn't process the specific content

**Why Gemini Succeeded:**
- More flexible parameter handling
- Better support for your prompt format
- Handled the web search integration properly

---

## 🎯 Action Items

### 1. Update IDENTITY.md

Add transparency about model reporting:

```markdown
## Communication Style

**Model transparency:**
After significant work, I report which model handled the task.
This helps track performance and costs.

Format: "[Model: provider/model-name]"
```

### 2. Create Memory Entry

Tell your agent to document model performance:

```
Create a memory file at memory/openrouter-model-performance.md 
tracking which models work best for different task types:
- Code generation → Best model?
- Analysis → Best model?
- Research → Best model?
- Documentation → Best model?

Update it as you learn which models excel at what.
```

### 3. Monitor Failures

```
During heartbeats, check if OpenRouter Auto is experiencing 
high failure rates. If >50% of attempts fail before success, 
alert me so we can investigate or configure specific models.
```

---

## 📚 References

- [OpenRouter Auto Router Guide](https://openrouter.ai/docs/guides/routing/routers/auto-router)
- [Get Generation Metadata API](https://openrouter.ai/docs/api-reference/get-a-generation)
- [API Parameters Reference](https://openrouter.ai/docs/api/reference/parameters)
- [OpenRouter Models Overview](https://openrouter.ai/docs/guides/overview/models)
- [Practical OpenRouter Guide (2026)](https://medium.com/@milesk_33/a-practical-guide-to-openrouter-unified-llm-apis-model-routing-and-real-world-use-d3c4c07ed170)

---

## 🦞 Summary for Horizon Builder

Your agent should:
1. ✅ Report model used after significant tasks
2. ✅ Note failures and routing attempts
3. ✅ Track which models work best for what
4. ✅ Alert on high failure rates
5. ✅ Maintain model performance memory

This transparency helps optimize your setup over time!

---

_Created: 2026-02-03 - OpenRouter Model Tracking Guide_
