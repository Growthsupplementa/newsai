require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { updateNotion } = require('./notion');
const { sendEmail, renderTemplate } = require('./mailer');
const { startImapWatcher } = require('./imapWatcher');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, text, html } = req.body;
    await sendEmail({ to, subject, text, html });
    res.json({ ok: true });
  } catch (err) {
    console.error('send-email error', err);
    res.status(500).json({ error: err.message });
  }
});

function verifyHmac(req) {
  const secret = process.env.DIALER_SECRET;
  if (!secret) return true; // no secret configured -> skip verification
  const signature = req.headers['x-dialer-signature'] || req.headers['x-hub-signature'] || '';
  if (!signature) return false;
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return signature === hmac;
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

app.listen(PORT, async () => {
  console.log(`automation service listening on http://localhost:${PORT}`);
  try {
    await startImapWatcher();
  } catch (err) {
    console.error('imap watcher failed to start', err);
  }
});
