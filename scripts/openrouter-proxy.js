#!/usr/bin/env node
/**
 * OpenRouter Generation Tracker Proxy v3
 *
 * Sits between OpenClaw and OpenRouter.
 * Extracts generation ID from response body, fetches metadata, logs it.
 *
 * Agent reads latest model info from:
 *   logs/model-tracking.jsonl   (full history)
 *   memory/last-model-used.json (always latest)
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PROXY_PORT = 3939;

// Resolve API key
const API_KEY = process.env.OPENROUTER_API_KEY || (() => {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
    return match ? match[1].trim() : null;
  } catch { return null; }
})();

const WORKSPACE = path.join(__dirname, "..");
const TRACKING_LOG = path.join(WORKSPACE, "logs", "model-tracking.jsonl");
const LAST_MODEL_FILE = path.join(WORKSPACE, "memory", "last-model-used.json");

// Ensure dirs exist
[path.join(WORKSPACE, "logs"), path.join(WORKSPACE, "memory")].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function appendLog(fp, data) { fs.appendFileSync(fp, JSON.stringify(data) + "\n"); }
function writeJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2)); }

async function fetchMetadata(genId) {
  return new Promise((resolve, reject) => {
    https.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
      headers: { "Authorization": `Bearer ${API_KEY}` }
    }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject).setTimeout(10000, function() { this.destroy(); reject(new Error("timeout")); });
  });
}

async function trackGeneration(genId) {
  try {
    log(`🔍 Fetching metadata for: ${genId}`);
    const meta = await fetchMetadata(genId);
    const d = meta.data;

    if (!d) {
      log(`⚠️ No .data in metadata: ${JSON.stringify(meta).substring(0, 200)}`);
      return;
    }

    const failures = (d.provider_responses || [])
      .filter(r => r.status !== 200)
      .map(r => ({ provider: r.provider_name, model: r.model_permaslug, status: r.status, latency: r.latency }));

    const tracked = {
      timestamp: new Date().toISOString(),
      generation_id: genId,
      model: d.model,
      router: d.router || "direct",
      cost: d.total_cost,
      tokens_prompt: d.tokens_prompt,
      tokens_completion: d.tokens_completion,
      latency: d.latency,
      provider_name: d.provider_name,
      failures: failures
    };

    appendLog(TRACKING_LOG, tracked);
    writeJSON(LAST_MODEL_FILE, tracked);

    const failMsg = failures.length > 0
      ? ` | ⚠️ ${failures.map(f => `${f.provider}/${f.model}(${f.status})`).join(", ")}`
      : "";
    log(`✅ ${tracked.model} via ${tracked.router} | $${tracked.cost} | ${tracked.tokens_prompt}p/${tracked.tokens_completion}c${failMsg}`);
  } catch (err) {
    log(`❌ Error: ${err.message}`);
  }
}

function forwardToOpenRouter(clientReq, clientRes) {
  const targetUrl = new URL(clientReq.url, "https://openrouter.ai");
  const isCompletions = clientReq.url.includes("/chat/completions");

  const options = {
    hostname: targetUrl.hostname,
    port: 443,
    path: targetUrl.pathname + targetUrl.search,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: targetUrl.hostname }
  };

  if (API_KEY && !options.headers["authorization"]) {
    options.headers["authorization"] = `Bearer ${API_KEY}`;
  }

  const proxyReq = https.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);

    if (isCompletions && proxyRes.statusCode === 200) {
      let chunks = [];
      proxyRes.on("data", (chunk) => {
        chunks.push(chunk);
        clientRes.write(chunk);
      });
      proxyRes.on("end", () => {
        clientRes.end();
        try {
          const body = Buffer.concat(chunks).toString();
          let genId = null;

          // Non-streaming: full JSON
          try {
            const parsed = JSON.parse(body);
            if (parsed.id && parsed.id.startsWith("gen-")) genId = parsed.id;
          } catch {
            // Streaming SSE: extract gen- IDs from data chunks
            const matches = body.match(/gen-[a-zA-Z0-9-]+/g);
            if (matches) genId = matches[0];
          }

          if (genId) trackGeneration(genId);
          else log(`⚠️ No gen ID in response`);
        } catch (e) { log(`⚠️ Parse error: ${e.message}`); }
      });
    } else {
      proxyRes.pipe(clientRes);
    }
  });

  proxyReq.on("error", (err) => {
    log(`❌ Proxy error: ${err.message}`);
    if (!clientRes.headersSent) { clientRes.writeHead(502); clientRes.end("Proxy error"); }
  });

  clientReq.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  log(`📨 ${req.method} ${req.url}`);
  forwardToOpenRouter(req, res);
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  log(`🦞 OpenRouter Proxy v3 on port ${PROXY_PORT}`);
  log(`   Tracking → ${TRACKING_LOG}`);
  log(`   Last model → ${LAST_MODEL_FILE}`);
  if (API_KEY) log(`   Key: ${API_KEY.substring(0, 12)}...`);
  else log("⚠️ No API key!");
});
