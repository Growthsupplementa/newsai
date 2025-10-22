require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { updateNotion } = require('./notion');
const { sendEmail, renderTemplate, verifyProviders, qualityChecks, safeSend, generateVariants } = require('./mailer');
const { startImapWatcher } = require('./imapWatcher');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;

app.get('/health', (req, res) => res.json({ ok: true }));

// Send email endpoint. Supports query param mode=verify to only verify provider connectivity and message quality.
app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, text, html, lead, provider, safe } = req.body || {};
    const mode = (req.query.mode || 'send');

    // If verify mode, run provider checks and quality checks without sending
    if (mode === 'verify') {
      const providerChecks = await verifyProviders();
      const q = qualityChecks({ to, subject, text, html });
      return res.json({ ok: true, providerChecks, quality: q });
    }

    // In send mode, if safe param present, use safeSend which will run quality checks and warming sequence
    if (safe) {
      const result = await safeSend({ to, subject, text, html, lead, provider, safe });
      return res.json({ ok: true, result });
    }

    // default direct send (sendEmail will enforce live guardrails)
    await sendEmail({ to, subject, text, html, lead, provider });
    res.json({ ok: true });
  } catch (err) {
    console.error('send-email error', err);
    res.status(500).json({ error: err.message });
  }
});

function verifyHmac(req) {
  const secret = process.env.DIALER_SECRET;
  if (!secret) return true; // no secret configured -> skip verification
  // Twilio has its own signature flow
  const twilioSig = req.headers['x-twilio-signature'];
  if (twilioSig && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require('twilio');
      const url = process.env.DIALER_WEBHOOK_URL || `https://${req.headers.host}${req.originalUrl}`;
      const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, twilioSig, url, req.body);
      return isValid;
    } catch (e) {
      console.warn('twilio verify failed', e && e.message);
    }
  }

  const signature = req.headers['x-dialer-signature'] || req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'] || '';
  if (!signature) return false;
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  // signatures may be sent as sha256=... or raw
  const sigClean = signature.replace(/^sha256=/i, '');
  return sigClean === hmac;
}

// Example transformation for Twilio call webhook payload
function transformTwilioEvent(body) {
  // Twilio StatusCallback POST has CallSid, From, To, CallStatus, etc.
  return {
    phone: body.From,
    status: body.CallStatus,
    callSid: body.CallSid,
    lead: {
      name: body.CallerName || '',
      phone: body.From
    }
  };
}

app.post('/webhook/dialer', async (req, res) => {
  try {
    if (!verifyHmac(req)) {
      console.warn('dialer webhook HMAC verification failed');
      return res.status(401).json({ error: 'invalid signature' });
    }
    let event = req.body;
    // auto-detect Twilio (simple heuristics)
    if (req.headers['user-agent'] && /twilio/i.test(req.headers['user-agent'])) {
      event = transformTwilioEvent(req.body);
    }
    console.log('dialer event', event);
    if (event.lead) {
      // Optionally generate a personalized follow-up email
      const template = 'Hi {name},\n\nThanks for your time. I noticed you mentioned {topic}. Would you like to schedule a quick follow-up?\n\nBest,\nTeam';
      const research = { topic: 'our product' }; // placeholder for real research
      const html = renderTemplate(template, { name: event.lead.name || 'there', ...research });
      await updateNotion(event.lead);
      await sendEmail({ to: event.lead.email || '', subject: 'Thanks for your time', text: html });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('dialer webhook error', err);
    res.status(500).json({ error: err.message });
  }
});

// Minimal MCP-compatible endpoint to receive events from model-context-protocol agents
// Example: { type: 'send_email', payload: { to, subject, template, provider } }
app.post('/mcp', async (req, res) => {
  try {
    const { type, payload } = req.body || {};
    if (!type) return res.status(400).json({ error: 'missing type' });
    switch (type) {
      case 'send_email':
        await sendEmail({
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
          lead: payload.lead,
          provider: payload.provider
        });
        return res.json({ ok: true });
      case 'create_lead':
        await updateNotion(payload.lead);
        return res.json({ ok: true });
      case 'dialer_event':
        // allow MCP to inject dialer events
        if (payload.lead) await updateNotion(payload.lead);
        return res.json({ ok: true });
      default:
        return res.status(400).json({ error: 'unknown type' });
    }
  } catch (err) {
    console.error('mcp handler error', err);
    return res.status(500).json({ error: err.message });
  }
});

// Preview / test endpoints
app.post('/preview-email', async (req, res) => {
  try {
    const { template, lead, variants, refine, tone, to, subject } = req.body;
    const out = await generateVariants(template, lead, { variants: variants || 3, refine, tone });
    const q = qualityChecks({ to, subject, text: out[0], html: out[0] });
    res.json({ variants: out, quality: q });
  } catch (err) {
    console.error('preview-email error', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: provider status / health checks
app.get('/provider-status', async (req, res) => {
  try {
    const checks = await verifyProviders();
    res.json({ ok: true, checks });
  } catch (err) {
    console.error('provider-status error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.listen(PORT, async () => {
  console.log(`automation service listening on http://localhost:${PORT}`);
  try {
    await startImapWatcher();
  } catch (err) {
    console.error('imap watcher failed to start', err);
  }

  // start queue worker when REDIS_URL configured
  try {
    if (process.env.REDIS_URL) {
      const { startWorker } = require('./queueWorker');
      startWorker().catch(e => console.error('queue worker failed', e && e.message));
    }
  } catch (e) {
    console.warn('queue worker could not be started', e && e.message);
  }
});
