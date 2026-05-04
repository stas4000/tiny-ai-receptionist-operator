# Tiny AI Receptionist Operator

An open-source demo that turns messy inbound inquiries into qualified lead handoffs.

Live demo:

https://teleclaudius.bles-software.com/ai-receptionist-live

## What It Shows

- A buyer sends a messy, natural-language inquiry.
- The operator extracts name, contact, business type, request, timing, and budget clues.
- It scores the lead and chooses the owner action.
- It formats a Telegram-style owner alert and Gmail follow-up note.
- The visual layer is a Three.js operator field designed for short X videos.

The demo is static-first. It does not require API keys to run.

## Run Locally

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8080
```

## Optional Lead Endpoint

The included Node server exposes:

```text
POST /api/leads
```

Example:

```bash
curl -s http://127.0.0.1:8080/api/leads \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hi, this is Maya from Northline Dental. We miss calls and need an AI receptionist this week. Budget is $1500/month. Email maya@example.com"}'
```

Set `LEAD_WEBHOOK_URL` to forward qualified leads to your own automation.

## Files

- `index.html`: the complete interactive front-end demo.
- `server.js`: optional local endpoint and deterministic lead qualifier.
- `package.json`: local run/check scripts.

## Notes

This is a shareable proof-of-concept, not a production CRM. A production deployment should add authentication, spam controls, consent handling, logging policy, and real notification integrations.
