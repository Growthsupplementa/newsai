let queueInstance = null;

function isRedisConfigured() {
  return !!process.env.REDIS_URL;
}

function getQueue() {
  if (queueInstance) return queueInstance;
  if (!isRedisConfigured()) return null;
  // lazy-require heavy deps so module can be required in environments without them
  const Bull = require('bull');
  queueInstance = new Bull('automation-warm', process.env.REDIS_URL);
  return queueInstance;
}

module.exports = { getQueue, isRedisConfigured };
