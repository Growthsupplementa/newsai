const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.resolve(__dirname, '.providers.json');

function getKey() {
  return process.env.PROVIDER_STORE_KEY || null;
}

function encrypt(text) {
  const key = getKey();
  if (!key) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(encrypted) {
  const key = getKey();
  if (!key) return encrypted;
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) return encrypted;
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const text = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(text, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.warn('providerStore decrypt failed', e && e.message);
    return encrypted;
  }
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return { providers: {}, active: null };
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    // decrypt secrets if needed
    Object.keys(data.providers || {}).forEach(name => {
      const p = data.providers[name];
      if (p && p.secretEncrypted) {
        try {
          p.secret = JSON.parse(decrypt(p.secretEncrypted));
        } catch (e) {
          p.secret = null;
        }
      }
    });
    return data;
  } catch (e) {
    console.warn('failed to load provider store', e && e.message);
    return { providers: {}, active: null };
  }
}

function saveStore(store) {
  const out = { providers: {}, active: store.active || null };
  Object.keys(store.providers || {}).forEach(name => {
    const p = store.providers[name];
    // don't write raw secret; encrypt if key present, otherwise omit
    const safe = { type: p.type, meta: p.meta || {} };
    if (p.secret) {
      try {
        safe.secretEncrypted = encrypt(JSON.stringify(p.secret));
      } catch (e) {
        console.warn('failed to encrypt provider secret', e && e.message);
      }
    }
    out.providers[name] = safe;
  });
  fs.writeFileSync(STORE_PATH, JSON.stringify(out, null, 2), 'utf8');
}

function listProviders() {
  const store = loadStore();
  return Object.keys(store.providers || {}).map(name => ({ name, type: store.providers[name].type, meta: store.providers[name].meta }));
}

function getProvider(name) {
  const store = loadStore();
  const p = store.providers && store.providers[name];
  if (!p) return null;
  const result = { name, type: p.type, meta: p.meta || {}, secret: p.secret || null };
  return result;
}

function setProvider(name, { type, meta, secret }) {
  const store = loadStore();
  store.providers = store.providers || {};
  store.providers[name] = { type, meta: meta || {}, secret: secret || null };
  saveStore(store);
}

function setActiveProvider(name) {
  const store = loadStore();
  if (!store.providers || !store.providers[name]) throw new Error('provider not found');
  store.active = name;
  saveStore(store);
}

function getActiveProvider() {
  const store = loadStore();
  const name = store.active;
  if (!name) return null;
  const p = store.providers[name];
  if (!p) return null;
  return { name, type: p.type, meta: p.meta || {}, secret: p.secret || null };
}

module.exports = { listProviders, setProvider, getProvider, setActiveProvider, getActiveProvider, loadStore, saveStore };
