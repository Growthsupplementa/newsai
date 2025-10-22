const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { updateNotion } = require('./notion');
const { sendEmail } = require('./mailer');

const config = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASS,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    tls: true,
    authTimeout: 3000
  }
};

async function startImapWatcher() {
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER) {
    console.warn('IMAP not configured; skipping IMAP watcher');
    return;
  }

  const connection = await Imap.connect(config);
  await connection.openBox('INBOX');
  console.log('IMAP connected, watching INBOX');

  connection.on('mail', async (numNewMsgs) => {
    console.log('mail event, new messages:', numNewMsgs);
    try {
      const searchCriteria = ['UNSEEN'];
      const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'], markSeen: true };
      const results = await connection.search(searchCriteria, fetchOptions);
      for (const res of results) {
        const all = res.parts && res.parts.find(p => p.which === 'TEXT');
        const raw = all && all.body;
        const parsed = await simpleParser(raw);
        console.log('parsed email from', parsed.from && parsed.from.text);
        // Example: if the subject contains a lead email, update notion
        const subject = parsed.subject || '';
        if (/follow[- ]?up/i.test(subject)) {
          const lead = { name: parsed.from?.value?.[0]?.name, email: parsed.from?.value?.[0]?.address, status: 'Follow-up', notes: subject };
          await updateNotion(lead);
          // Optional auto-reply
          await sendEmail({ to: lead.email, subject: 'Re: ' + subject, text: 'Thanks for your message. We will follow up shortly.' });
        }
      }
    } catch (err) {
      console.error('error processing mail event', err);
    }
  });
}

module.exports = { startImapWatcher };
