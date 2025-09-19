# BTG-One-Kiosk

1) Project overview
Goal: A storefront kiosk that lets walk-in customers:
start a new service ticket in RepairShopr (RS),
check the status of an existing ticket (phase 2),
optionally interact with a friendly assistant (“Bella/Rover”) that helps collect info.
Non-goals: the kiosk should not expose API keys, should not depend on an embedded third-party form/iframe, and should work even if AI is offline.
Current state (MVP):
Frontend: single-page HTML/CSS/JS app (two-column layout: chat on the left, form on the right).
Backend: Node/Express service that:
finds/creates a RepairShopr customer,
creates a ticket (/api/repairshopr/ticket),
proxies OpenAI chat completions (/api/llm) so keys never sit in the browser,
exposes a health check (/api/health).
Reverse proxy: Apache routes /api/* → Node on 127.0.0.1:3000.
Current UX reality: The chat can assist, but the recommended final product is form-first with optional AI assist. (Rationale in “Product decisions” below.)
2) Product decisions & requirements
2.1 UX approach
Primary path: large, touch-friendly form that collects First name, Last name, Mobile, Email, and Issue description, then submits.
Optional path: conversational panel where Bella asks one question at a time and suggests values; user can accept/edit, then submit.
Help: a “Need help?” button to notify staff (Teams/SMS; server-side integration later).
Check status: separate simple form (Mobile/Email + Last name) (phase 2).
2.2 Functional requirements (MVP)
Create a ticket in RS using customer info, issue summary, and internal note with device/context.
If customer not found, create one in RS.
Return { ok, ticket_number } to the client.
Hard requirements for submission: first_name, last_name, mobile, email.
2.3 Non-functional requirements
Reliability: if AI fails, the deterministic form still completes.
Security: no secrets in client; HTTPS; rate-limited API; minimal PII in logs.
Accessibility: big tap targets, labels, high contrast, on-screen keyboard friendly.
