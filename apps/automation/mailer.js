const nodemailer = require('nodemailer');
const axios = require('axios');

// Basic spintax parser: {a|b} -> randomly choose
// Nested spintax parser: supports nested {a|{b|c}} structures
function parseSpintax(text) {
  if (!text) return '';
  // recursively replace deepest braces first
  while (/\{([^{}]+)\}/.test(text)) {
    text = text.replace(/\{([^{}]+)\}/g, (_, group) => {
      const parts = group.split('|');
      return parts[Math.floor(Math.random() * parts.length)];
    });
  }
  return text;
}

// Simple template renderer: interpolate {name} and run spintax
function renderTemplate(template, vars = {}) {
  let out = template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');
  out = parseSpintax(out);
  return out;
}

// Generate variants: combine deterministic templating with spintax and optional LLM rewrites
async function generateVariants(template, lead = {}, opts = { variants: 3 }) {
  const variants = [];
  // quick path: generate by spintax and templating
  for (let i = 0; i < (opts.variants || 3); i++) {
    const research = lead ? await personalizeResearch(lead) : {};
    const text = renderTemplate(template, { ...lead, ...research });
    variants.push(text);
  }

  // optionally refine using OpenAI if configured and allowed
  if (process.env.OPENAI_API_KEY && opts.refine) {
    try {
      const { Configuration, OpenAIApi } = require('openai');
      const conf = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
      const client = new OpenAIApi(conf);
      const prompt = `Rewrite the following email message to be more ${opts.tone || 'professional'}, keep main points, and produce ${variants.length} short variants.\n\nMessage:\n${template}`;
      const resp = await client.createCompletion({ model: 'text-davinci-003', prompt, max_tokens: 300 });
      const text = resp.data.choices?.[0]?.text?.trim();
      if (text) {
        // split by double newline as heuristic
        const parts = text.split(/\n\n+/).filter(Boolean);
        for (let i = 0; i < Math.min(parts.length, variants.length); i++) variants[i] = parts[i].trim();
      }
    } catch (e) {
      console.warn('OpenAI refine failed', e && e.message);
    }
  }

  return variants;
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
function isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true';
}

function getSmtpTransport() {
  if (smtpTransporter) return smtpTransporter;

  // If SMTP credentials are provided, prefer using them (live authenticated mailer)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
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

  // Only allow Ethereal or JSON transport in explicit test mode.
  if (isTestMode()) {
    // Try sync creation if available (older code paths), otherwise use async-safe JSON transport.
    const account = nodemailer.createTestAccountSync?.() || null;
    if (account) {
      smtpTransporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass }
      });
      console.log('Using Ethereal test account for SMTP. Preview URLs will be logged.');
      return smtpTransporter;
    }

    smtpTransporter = nodemailer.createTransport({ jsonTransport: true });
    console.log('Using JSON transport for emails (TEST MODE, no SMTP configured).');
    return smtpTransporter;
  }

  // In non-test (live) mode, we require an authenticated provider. Fail fast if none is configured.
  throw new Error('No authenticated SMTP configured and not in TEST_MODE. Set SMTP_HOST/SMTP_USER/SMTP_PASS or use an API provider (SENDGRID_API_KEY or MAILERLITE_API_KEY).');
}

function chooseDefaultProvider() {
  // Prefer SMTP when credentials present, otherwise try SendGrid, then MailerLite
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.MAILERLITE_API_KEY) return 'mailerlite';
  return null;
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
  // If provider explicitly requested, honor it (but validate for live mode)
  if (!provider) {
    provider = chooseDefaultProvider();
  }

  // Allow console/dry-run in any mode if explicitly requested
  if (provider === 'console' || provider === 'dry-run') {
    console.log('DRY-RUN sendEmail', { to, subject, text, html });
    return { ok: true, dryRun: true };
  }

  // If no provider chosen and we're not in test mode -> fail fast to avoid accidental JSON transport in production
  if (!provider && !isTestMode()) {
    throw new Error('No mail provider configured for live mode. Set SMTP_* or SENDGRID_API_KEY/MAILERLITE_API_KEY.');
  }

  if (provider === 'sendgrid') {
    return sendViaSendGrid({ to, subject, text, html });
  }
  if (provider === 'mailerlite') {
    return sendViaMailerLite({ to, subject, text, html });
  }

  // Default to SMTP transport (this will throw in live mode if no SMTP present)
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

// --- Provider connectivity verification helpers ---
async function verifySmtpConnection() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return { ok: false, reason: 'missing SMTP credentials' };
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 5000
    });
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
}

async function verifySendGrid() {
  if (!process.env.SENDGRID_API_KEY) return { ok: false, reason: 'missing SENDGRID_API_KEY' };
  try {
    const res = await axios.get('https://api.sendgrid.com/v3/user/account', { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` } });
    if (res.status === 200) return { ok: true };
    return { ok: false, reason: `status ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
}

async function verifyMailerLite() {
  if (!process.env.MAILERLITE_API_KEY) return { ok: false, reason: 'missing MAILERLITE_API_KEY' };
  try {
    const res = await axios.get('https://api.mailerlite.com/api/v2/accounts', { headers: { 'X-MailerLite-ApiKey': process.env.MAILERLITE_API_KEY } });
    if (res.status === 200) return { ok: true };
    return { ok: false, reason: `status ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
}

async function verifyProviders() {
  const checks = {};
  checks.smtp = await verifySmtpConnection();
  checks.sendgrid = await verifySendGrid();
  checks.mailerlite = await verifyMailerLite();
  return checks;
}

// --- Message quality checks ---
function qualityChecks({ to, subject, text, html }) {
  const issues = [];
  if (!to || typeof to !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) issues.push('invalid or missing recipient email');
  if (!subject || subject.trim().length < 5) issues.push('subject too short');
  const body = (text || html || '').replace(/<[^>]*>/g, '');
  if (body.length < 30) issues.push('body too short');
  // naive profanity check (can be extended)
  const profane = /(fuck|shit|bitch|asshole)/i;
  if (profane.test(body)) issues.push('contains profanity');
  // personalization token presence
  if (!/\{name\}|\{company\}|\{researchSnippet\}/.test(subject + body)) issues.push('no personalization tokens found (recommend using {name}, {company}, or {researchSnippet})');
  return { ok: issues.length === 0, issues };
}

// --- Safe send scheduler / warming sequence ---
// safeSend accepts params: { to, subject, text, html, lead, provider, safe: { warmSequence: [ {delaySec, provider, batchSize} ], sendWindow: { startHour, endHour } } }
const { getQueue, isRedisConfigured } = require('./queue');

async function safeSend(params = {}) {
  const { to, subject, text, html, lead, provider, safe } = params;
  // Validate message quality first
  const q = qualityChecks({ to, subject, text, html });
  if (!q.ok) {
    throw new Error('Message quality checks failed: ' + q.issues.join('; '));
  }

  // If safe not provided or empty, send immediately using sendEmail (but will still respect live guardrails in sendEmail)
  if (!safe || !safe.warmSequence || !Array.isArray(safe.warmSequence) || safe.warmSequence.length === 0) {
    return sendEmail({ to, subject, text, html, lead, provider });
  }

  // If Redis configured, enqueue a durable warm-send job
  if (isRedisConfigured()) {
    const q = getQueue();
    if (!q) throw new Error('Queue not available despite REDIS_URL');
    const job = await q.add({ to, subject, text, html, lead, provider, safe });
    return { ok: true, enqueued: true, jobId: job.id };
  }

  // Fallback to in-process execution if REDIS not configured
  for (const step of safe.warmSequence) {
    const stepProvider = step.provider || provider;
    const delay = Number(step.delaySec || 0) * 1000;
    const batchSize = Number(step.batchSize || 1);
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    if (!isTestMode() && !chooseDefaultProvider() && !stepProvider) {
      throw new Error('No provider available for live warm sequence');
    }
    await sendEmail({ to, subject, text, html, lead, provider: stepProvider });
  }

  return { ok: true, warmed: true };
}

module.exports = { sendEmail, renderTemplate, generateVariants, verifyProviders, qualityChecks, safeSend };

