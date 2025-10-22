require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { updateNotion } = require('./notion');
const { sendEmail } = require('./mailer');
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

app.post('/webhook/dialer', async (req, res) => {
  // Minimal: accept dialer event, update Notion and optionally send email
  try {
    const event = req.body;
    console.log('dialer event', event);
    // Example: event { phone, status, callRecordingUrl, lead }
    if (event.lead) {
      await updateNotion(event.lead);
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
