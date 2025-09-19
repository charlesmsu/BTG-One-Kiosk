# BTG One Kiosk

A storefront kiosk that lets walk-in customers create a **RepairShopr** ticket (Phase 1) and, in Phase 2, check existing ticket status. Built **form-first** for reliability, with an optional “Bella” assistant that can help fill fields. All vendor calls go through a secure server proxy — **no secrets in the browser**.

![Status](https://img.shields.io/badge/status-MVP--handoff-blue)
![Stack](https://img.shields.io/badge/stack-Node%2020%20%7C%20Express%20%7C%20Apache%20proxy%20%7C%20Vanilla%20JS-informational)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#license)

---

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Repo Layout](#repo-layout)
- [Prerequisites](#prerequisites)
- [Quick Start (Local Dev)](#quick-start-local-dev)
- [Configuration](#configuration)
- [API](#api)
  - [`GET /api/health`](#get-apihealth)
  - [`POST /api/repairshopr/ticket`](#post-apirepairshoprticket)
  - [`POST /api/llm` (optional)](#post-apillm-optional)
- [Frontend](#frontend)
- [Deployment (Ubuntu + Apache)](#deployment-ubuntu--apache)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Roadmap](#roadmap)
- [History & Known Pitfalls](#history--known-pitfalls)
- [Hand-Off Acceptance Criteria](#hand-off-acceptance-criteria)
- [License](#license)

---

## Overview

**Goal:** Let customers quickly start a ticket without staff intervention.

**Primary flow:** Customer fills a short form → server creates RepairShopr (RS) customer/ticket → success screen.  
**Optional:** Chat assistant (“Bella”) that *suggests* values; never blocks the deterministic form.  
**Non-goals:** Embedding third-party forms/iframes, exposing API keys client-side, making AI mandatory.

> Kiosk users span ages & abilities — deterministic forms reduce friction and latency. The AI assistant is additive, not required.

---

## Architecture

```mermaid
flowchart LR
  A[Browser (Kiosk)] -- /api/* --> B[Apache Reverse Proxy]
  B -- 127.0.0.1:3000 --> C[Node/Express API]
  C -- HTTPS --> D[RepairShopr API]
  C -- HTTPS --> E[OpenAI API (optional)]
```

- **Apache** serves static assets and proxies `/api/*` → Node (`127.0.0.1:3000`).
- **Node/Express** exposes:
  - `POST /api/repairshopr/ticket` (find/create customer, create ticket).
  - `POST /api/llm` (optional, OpenAI proxy; keeps keys off the client).
  - `GET  /api/health` (readiness).

---

## Features

- **Form-first** check-in (First, Last, Mobile, Email, Issue).
- **Server-side** RS integration (no iframes / cross-origin headaches).
- **Optional chat assist** (Bella) that pre-fills the same fields.
- **Health** endpoint for ops.
- **Reverse proxy** via Apache (single origin for the browser).

---

## Repo Layout

```
/ (repo root)
├─ public/                 # Frontend (static assets)
│  ├─ index.html           # Kiosk UI (form + optional chat)
│  ├─ chat.js              # Client logic (calls /api/llm; fills form)
│  ├─ styles.css
│  └─ assets/
├─ server/                 # Backend (Node/Express)
│  ├─ server.js            # Main app (health, RS ticket, LLM proxy)
│  ├─ routes/              # (optional future split)
│  └─ lib/                 # (helpers, logging, RS client)
├─ .env.example            # Config template (no secrets)
├─ ISSUES.md               # History of blockers & root causes (optional separate file)
└─ README.md               # This file
```

*(If your current code is flatter, this is the target structure for maintainability.)*

---

## Prerequisites

- **Node.js** 20.x (uses built-in `fetch`)
- **npm** 9+
- **Ubuntu 22.04+**
- **Apache** with `proxy` and `proxy_http` modules
- **RepairShopr** API token (Customers + Tickets permissions)
- Optional: **OpenAI** API key (only if enabling chat assist)

---

## Quick Start (Local Dev)

```bash
# 0) Clone
git clone https://github.com/<org>/btg-one-kiosk.git
cd btg-one-kiosk

# 1) Configure server env
cp .env.example server/.env
# Edit server/.env with your RS subdomain and API keys (see Configuration)

# 2) Install & run API
cd server
npm i
node server.js          # API listening on :3000

# 3) Test health
curl -s http://127.0.0.1:3000/api/health
# -> {"ok":true}

# 4) (Optional) Serve ./public in another terminal for local UI
# e.g., npx http-server ./public -p 8080  → http://localhost:8080
```

---

## Configuration

Create **`server/.env`** (never commit real secrets):

```ini
# RepairShopr
REPAIRSHOPR_SUBDOMAIN=billingstechguys
REPAIRSHOPR_API_KEY=***ROTATE_ME***

# Chat assistant (optional)
OPENAI_API_KEY=***ROTATE_ME***

# Server
PORT=3000
NODE_ENV=production
```

A copyable **`.env.example`** for the repo:

```ini
REPAIRSHOPR_SUBDOMAIN=
REPAIRSHOPR_API_KEY=
OPENAI_API_KEY=
PORT=3000
NODE_ENV=production
```

> Rotate any previously shared keys. Keep `.env` readable by the service user only (e.g., `chmod 640`).

---

## API

### GET `/api/health`

Readiness probe.

**200 OK**
```json
{ "ok": true }
```

---

### POST `/api/repairshopr/ticket`

Finds (or creates) a RepairShopr customer, then creates a ticket.

**Request**
```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "mobile": "+13035551234",
  "email": "jane@example.com",

  "issue": "Laptop won't boot",          // used in subject and internal note
  "visit_reason": "Diagnostics",         // optional → maps to problem_type
  "device_brand": "HP",                  // optional
  "device_model": "Pavilion 15",         // optional
  "onsite_or_dropoff": "dropoff",        // optional

  "phone": "+13035550000",               // optional
  "address": "123 Main St",
  "city": "Billings",
  "state": "MT",
  "zip": "59101"
}
```

**Response (200)**
```json
{
  "ok": true,
  "ticket_id": 12345,
  "ticket_number": "T-0012345",
  "ticket": { "...": "opaque RS payload" }
}
```

**Error examples**
```json
{ "ok": false, "error": "Missing fields: first_name, ..." }
{ "ok": false, "error": "RepairShopr ticket create failed", "detail": { "...": "RS response" } }
```

**Notes**
- Required: `first_name`, `last_name`, `mobile`, `email`
- `subject` derives from `visit_reason || issue || "New Service Request"`
- Adds a first **internal** comment with captured details

---

### POST `/api/llm` (optional)

Proxy to OpenAI; keeps keys server-side. Returns the model’s **raw string**; the client parses.

**Request**
```json
{
  "messages": [
    { "role": "system", "content": "Return exactly {"say":"...","set":{...},"done":false}" },
    { "role": "user", "content": "Hello" }
  ],
  "model": "gpt-4o-mini",
  "temperature": 0.2
}
```

**Response (200)**
```json
{ "ok": true, "content": "{"say":"...","set":{...},"done":false}" }
```

---

## Frontend

- **Form submits** to `/api/repairshopr/ticket`.
- **Optional chat** calls `/api/llm`; client parses `content` using a tolerant `safeParseJSON()` that:
  1) tries `JSON.parse`,  
  2) falls back to extracting the first `{...}` block with a regex,  
  3) if parsing still fails, shows a friendly clarification prompt (the form remains usable).
- **Never** put API keys in client code. All vendor calls go through the server.

---

## Deployment (Ubuntu + Apache)

**1) Run API as a service (choose one)**

**systemd**
```ini
# /etc/systemd/system/kiosk-api.service
[Unit]
Description=Kiosk API (RepairShopr + LLM proxy)
After=network.target

[Service]
WorkingDirectory=/path/to/repo/server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload
systemctl enable --now kiosk-api
systemctl status kiosk-api --no-pager
```

**pm2**
```bash
cd /path/to/repo/server
pm2 start server.js --name kiosk-api
pm2 save
pm2 startup   # follow one-time command it prints
```

**2) Apache reverse proxy**
```bash
a2enmod proxy proxy_http
cat >/etc/apache2/conf-available/kiosk-proxy.conf <<'EOF'
ProxyPreserveHost On
ProxyPass        /api/ http://127.0.0.1:3000/api/
ProxyPassReverse /api/ http://127.0.0.1:3000/api/
EOF
a2enconf kiosk-proxy
systemctl reload apache2
```

**3) Smoke tests**
```bash
# from the server
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1/api/health
# both should print {"ok":true}
```

---

## Troubleshooting

**`/api/health` 404/503/pending**  
Node not running or Apache proxy not active.
```bash
ss -ltnp | grep :3000
apachectl -M | egrep 'proxy|proxy_http'
curl -s 127.0.0.1:3000/api/health
curl -s 127.0.0.1/api/health
```

**OpenAI “string did not match pattern”**  
Remove `response_format` from the server request; return raw `content`; parse on the client.

**RS shapes differ (`id` vs `ticket.id`)**  
Normalize both cases; log raw RS body for 4xx/5xx; never assume a single shape.

**Secrets visible in DevTools**  
You’re calling vendors from the browser; route everything through `/api/*`.

**API dies after SSH logout**  
Use systemd or pm2 to keep it alive on boot and restart on crash.

---

## Security

- Secrets only in `server/.env`; never commit them.
- Rate-limit `/api/*`, sanitize inputs server-side.
- Helmet/CSP, HTTPS end-to-end.
- Minimal PII in logs (log statuses/IDs, not full bodies).
- Rotate keys on exposure; least-privilege RS token.

---

## Roadmap

- **Phase 2:** `/api/repairshopr/status` (lookup by mobile/email + last name).
- Teams/SMS notification after ticket creation (server-side).
- Returning-customer prefill when phone/email is entered.
- Post-submit rating → RS note on low scores.
- Offline draft + 10-minute inactivity timeout.
- CI smoke tests hitting `/api/health` and mocked RS API.

---

## History & Known Pitfalls

- **Secrets in browser:** early versions called OpenAI from client → fixed with `/api/llm`.
- **SOP/CORS with RS iframe:** cannot script third-party forms → replaced with our own form + server API.
- **Apache↔Node proxy:** misconfig leads to 404/503/pending → enable `proxy`, `proxy_http`, add `ProxyPass` rules, test both `127.0.0.1:3000/api/health` and `/api/health`.
- **ESM vs CommonJS:** `import` without `"type":"module"` → switched to CommonJS `require` (Node 20 `fetch` built-in).
- **OpenAI pattern error:** some model/account combos reject `response_format` → removed; return raw content; tolerant client parser.
- **RS response variance:** fields may be nested or top-level → normalize on read; log vendor errors.

---

## Hand-Off Acceptance Criteria

- Fresh checkout can:
  1) run `node server.js` and get `{"ok":true}` at `/api/health`,
  2) `POST /api/repairshopr/ticket` via curl and receive a `ticket_number`,
  3) submit the kiosk form and see the same result in the UI.
- No secrets present in frontend assets or browser DevTools.
- If OpenAI is down, the form still works end-to-end.

---

## License

MIT © Your Organization
