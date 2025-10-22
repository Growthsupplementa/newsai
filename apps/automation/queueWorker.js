require('dotenv').config();
const { getQueue, isRedisConfigured } = require('./queue');
const { sendEmail } = require('./mailer');

async function startWorker() {
  if (!isRedisConfigured()) {
    console.log('REDIS_URL not configured; queue worker not started');
    return;
  }
  const q = getQueue();
  if (!q) {
    console.log('Queue not available');
    return;
  }

  q.process(async (job) => {
    const { to, subject, text, html, lead, provider, safe } = job.data;
    console.log('Processing warm-send job', job.id, job.data);
    // For durability, we execute each step here; safe may include warmSequence but we treat as single-step send in worker
    try {
      if (safe && Array.isArray(safe.warmSequence) && safe.warmSequence.length > 0) {
        for (const step of safe.warmSequence) {
          const stepProvider = step.provider || provider;
          // respect step delay
          if (step.delaySec) await new Promise(r => setTimeout(r, Number(step.delaySec) * 1000));
          await sendEmail({ to, subject, text, html, lead, provider: stepProvider });
        }
      } else {
        await sendEmail({ to, subject, text, html, lead, provider });
      }
      return { ok: true };
    } catch (err) {
      console.error('warm-send job failed', err && err.message);
      throw err;
    }
  });

  q.on('completed', (job) => console.log('job completed', job.id));
  q.on('failed', (job, err) => console.log('job failed', job.id, err && err.message));

  console.log('Queue worker started for automation-warm');
}

module.exports = { startWorker };
