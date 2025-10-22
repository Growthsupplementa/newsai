newsai automation service
=========================

Small automation microservice that:
- updates a Notion database with lead/contact records
- sends outbound emails via SMTP
- watches an IMAP inbox for follow-ups and triggers actions
- exposes a webhook endpoint for dialer events (incoming call results)

Quick start

1. Copy `.env.example` to `.env` and fill in credentials.
2. cd apps/automation && npm install
3. npm start

Endpoints

- POST /webhook/dialer  -> receive dialer events (HMAC with DIALER_SECRET recommended)
- POST /send-email     -> send an email (json: to, subject, text/html)
