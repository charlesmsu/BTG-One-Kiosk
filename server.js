'use strict';

/**
 * Kiosk backend: creates RepairShopr tickets and proxies LLM calls.
 * CommonJS version (works without "type":"module"). Node 20+ required.
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ---- Env ----
const SUBDOMAIN = process.env.REPAIRSHOPR_SUBDOMAIN;  // e.g. "billingstechguys"
const API_KEY   = process.env.REPAIRSHOPR_API_KEY;    // RS API token
const OPENAI    = process.env.OPENAI_API_KEY;         // OpenAI key (for /api/llm)
const PORT      = process.env.PORT || 3000;

if (!SUBDOMAIN || !API_KEY) {
  console.error('Missing REPAIRSHOPR_SUBDOMAIN or REPAIRSHOPR_API_KEY in .env');
  process.exit(1);
}

const RS_BASE = `https://${SUBDOMAIN}.repairshopr.com/api/v1`;

// ---- Middleware ----
app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true })); // tighten to your kiosk origin in prod
app.use(express.json({ limit: '200kb' }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

// ---- Helpers ----
function rsUrl(path, params = {}) {
  const u = new URL(RS_BASE + path);
  u.searchParams.set('api_key', API_KEY); // RS expects query param auth
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.append(k, v);
  }
  return u.toString();
}

async function safeJson(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return text; }
}

function s(v, max = 256) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeProblemType(reason) {
  const r = (reason || '').toLowerCase();
  if (r.includes('virus') || r.includes('malware') || r.includes('ransom')) return 'Virus';
  if (r.includes('tune')) return 'TuneUp';
  if (r.includes('battery') || r.includes('screen') || r.includes('hardware')) return 'Other';
  return 'Software';
}

async function findCustomer({ email, mobile, phone, first_name, last_name }) {
  const query = s(email || mobile || phone || `${first_name} ${last_name}`, 120);
  const list = await fetch(rsUrl('/customers', { query }), { method: 'GET' });
  if (list.ok) {
    const data = await list.json();
    const customers = data?.customers || data;
    const exact = (customers || []).find(x => {
      const pool = [x?.email, x?.mobile, x?.phone].filter(Boolean);
      return pool.includes(email) || pool.includes(mobile) || pool.includes(phone);
    });
    if (exact?.id) return exact.id;
    if (customers?.[0]?.id) return customers[0].id;
  }
  return null;
}

async function createCustomer(c) {
  const body = {
    business_name: s(c.business_name, 120) || undefined,
    firstname: s(c.first_name, 80),
    lastname: s(c.last_name, 80),
    email: s(c.email, 120),
    phone: s(c.phone, 40) || undefined,
    mobile: s(c.mobile, 40),
    address: s(c.address, 120) || undefined,
    city: s(c.city, 80) || undefined,
    state: s(c.state, 40) || undefined,
    zip: s(c.zip, 20) || undefined,
  };

  const resp = await fetch(rsUrl('/customers'), {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await safeJson(resp);
    throw new Error(`RepairShopr customer create failed: ${JSON.stringify(err)}`);
  }
  const j = await resp.json();
  return j?.id || j?.customer?.id;
}

async function ensureCustomerId(c) {
  const existing = await findCustomer(c);
  if (existing) return existing;
  return await createCustomer(c);
}

// ---- Routes ----
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Create ticket from kiosk payload
app.post('/api/repairshopr/ticket', async (req, res) => {
  try {
    const c = req.body ?? {};
    const missing = ['first_name','last_name','email','mobile'].filter(k => !s(c[k]));
    if (missing.length) return res.status(400).json({ ok:false, error:`Missing fields: ${missing.join(', ')}` });

    const customer_id = await ensureCustomerId(c);

    const subject = s(c.visit_reason || c.issue || 'New Service Request', 120);
    const problem_type = normalizeProblemType(c.visit_reason || c.issue);

    const lines = [
      c.issue ? `Issue: ${s(c.issue, 2000)}` : null,
      (c.device_brand || c.device_model) ? `Device: ${s(c.device_brand,120)} ${s(c.device_model,120)}`.trim() : null,
      c.onsite_or_dropoff ? `Preference: ${s(c.onsite_or_dropoff, 40)}` : null,
      `Contact: ${s(c.first_name,80)} ${s(c.last_name,80)} — ${s(c.mobile,40)} / ${s(c.email,120)}`,
      (c.address || c.city || c.state || c.zip) ? `Address: ${[c.address,c.city,c.state,c.zip].filter(Boolean).map(x=>s(x,120)).join(', ')}` : null,
      c.extra_notes ? `Notes: ${s(c.extra_notes, 2000)}` : null,
    ].filter(Boolean).join('\n');

    const payload = {
      customer_id,
      subject,
      problem_type,
      comments_attributes: [{ subject: 'Kiosk Check-In', body: lines, hidden: true }],
    };

    const tRes = await fetch(rsUrl('/tickets'), {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    });
    if (!tRes.ok) {
      const err = await safeJson(tRes);
      return res.status(502).json({ ok:false, error:'RepairShopr ticket create failed', detail: err });
    }

    const ticket = await tRes.json();
    const ticket_id     = ticket?.id || ticket?.ticket?.id;
    const ticket_number = ticket?.number || ticket?.ticket?.number || ticket_id;
    res.json({ ok:true, ticket_id, ticket_number, ticket });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'Server error', detail:String(e) });
  }
});

// LLM proxy (keeps OpenAI key server-side)
app.post('/api/llm', async (req, res) => {
  try {
    const { messages, temperature = 0.2, model = 'gpt-4o-mini' } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error:'messages[] is required' });
    if (!OPENAI) return res.status(500).json({ error:'OPENAI_API_KEY missing in .env' });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI}`
      },
      body: JSON.stringify({
        model,
        temperature,
        // IMPORTANT: remove response_format to avoid the pattern error
        messages
      })
    });

    const j = await r.json();
    if (!r.ok || j.error) {
      // Surface the exact error from OpenAI for easier debugging
      return res.status(502).json({ error: j.error?.message || 'OpenAI proxy failed', detail: j });
    }

    // Return the raw assistant content as a string; client will parse with safeParseJSON(...)
    const content = j.choices?.[0]?.message?.content ?? '';
    return res.json({ ok: true, content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
