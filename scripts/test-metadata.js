const https = require('https');
const fs = require('fs');

const envContent = fs.readFileSync('/home/node/.openclaw/workspace/.env', 'utf8');
const API_KEY = envContent.match(/OPENROUTER_API_KEY=(.+)/)[1].trim();
const genId = 'gen-1770149223-8b5fGjbzGp7gGquv47DI';

https.get('https://openrouter.ai/api/v1/generation?id=' + genId, {
  headers: { 'Authorization': 'Bearer ' + API_KEY }
}, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    const meta = JSON.parse(body);
    const d = meta.data;
    
    console.log('=== Raw Fields ===');
    console.log('model:', d.model);
    console.log('router:', d.router);
    console.log('total_cost:', d.total_cost);
    console.log('tokens_prompt:', d.tokens_prompt);
    console.log('tokens_completion:', d.tokens_completion);
    console.log('latency:', d.latency);
    console.log('provider_name:', d.provider_name);

    const failures = (d.provider_responses || [])
      .filter(r => r.status !== 200)
      .map(r => ({ provider: r.provider_name, model: r.model_permaslug, status: r.status }));

    const tracked = {
      timestamp: new Date().toISOString(),
      generation_id: genId,
      model: d.model,
      router: d.router,
      cost: d.total_cost,
      tokens_prompt: d.tokens_prompt,
      tokens_completion: d.tokens_completion,
      latency: d.latency,
      provider_name: d.provider_name,
      failures: failures
    };

    fs.writeFileSync('/home/node/.openclaw/workspace/memory/last-model-used.json', JSON.stringify(tracked, null, 2));
    fs.appendFileSync('/home/node/.openclaw/workspace/logs/model-tracking.jsonl', JSON.stringify(tracked) + '\n');

    console.log('');
    console.log('=== Written ===');
    console.log(JSON.stringify(tracked, null, 2));
  });
});
