const nodemailer = require('nodemailer');

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  const info = await t.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
  console.log('sent email', info.messageId);
  return info;
}

module.exports = { sendEmail };
