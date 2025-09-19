// functions/chat.js
import 'dotenv/config';
import fetch from 'node-fetch';

// NEW (add this)
async function callLLM() {
  const res = await fetch('/api/llm', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: history
    })
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || 'LLM proxy failed');
  return j; // { say, set, done }
}