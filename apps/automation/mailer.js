const nodemailer = require('nodemailer');
const axios = require('axios');

// Basic spintax parser: {a|b} -> randomly choose
function parseSpintax(text) {
  return text.replace(/\{([^}]+)\}/g, (_, group) => {
    const parts = group.split('|');
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

// Simple template renderer: interpolate {name} and run spintax
function renderTemplate(template, vars = {}) {
  let out = template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');
  out = parseSpintax(out);
  return out;
}

// AI personalization using OpenAI (if configured)
async function personalizeResearch(lead) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const { Configuration, OpenAIApi } = require('openai');
      const conf = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
      const client = new OpenAIApi(conf);
      const prompt = `Generate a 1-2 sentence personalized research snippet about this lead for outreach. Lead data: ${JSON.stringify(lead)}`;
      const resp = await client.createCompletion({ model: 'text-davinci-003', prompt, max_tokens: 60 });
      const text = resp.data.choices?.[0]?.text?.trim();
      return { researchSnippet: text || `I see you're in ${lead.company || 'your industry'}.` };
    } catch (err) {
      console.warn('OpenAI personalization failed, falling back', err && err.message);
    }
  }
  return { researchSnippet: `I see you're in ${lead.company || 'your industry'}.` };
}

let smtpTransporter;
function getSmtpTransport() {
  if (smtpTransporter) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return smtpTransporter;
}

async function sendViaSendGrid({ to, subject, text, html }) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY not configured');
  const res = await axios.post('https://api.sendgrid.com/v3/mail/send', {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: process.env.EMAIL_FROM || process.env.SMTP_USER },
    subject,
    content: [{ type: 'text/plain', value: text || '' }, { type: 'text/html', value: html || '' }]
  }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
  return res.data;
}

async function sendViaMailerLite({ to, subject, text, html }) {
  const key = process.env.MAILERLITE_API_KEY;
  if (!key) throw new Error('MAILERLITE_API_KEY not configured');
  // MailerLite transactional API example (depends on account)
  const res = await axios.post('https://api.mailerlite.com/api/v2/email', {
    to, subject, html
  }, { headers: { 'X-MailerLite-ApiKey': key, 'Content-Type': 'application/json' } });
  return res.data;
}

async function sendEmail({ to, subject, text, html, lead, provider }) {
  // provider: 'smtp' (default) | 'sendgrid'
  // allow personalization
  if (lead) {
    const research = await personalizeResearch(lead);
    text = renderTemplate(text || '', { ...lead, ...research });
    html = renderTemplate(html || text || '', { ...lead, ...research });
  }

  if (provider === 'sendgrid') {
    return sendViaSendGrid({ to, subject, text, html });
  }
  if (provider === 'mailerlite') {
    return sendViaMailerLite({ to, subject, text, html });
  }

  const t = getSmtpTransport();
  const info = await t.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
  console.log('sent email', info && info.messageId);
  return info;
}

module.exports = { sendEmail, renderTemplate };
