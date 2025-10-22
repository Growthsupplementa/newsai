const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 3000;

const staticDir = path.join(__dirname);
app.use(express.static(staticDir));

// Choose proxy target based on environment:
// - If USE_REAL_API=true and GEMINI_API_KEY is set, forward requests to
//   Google Generative API (https://generative.googleapis.com) and add
//   Authorization header.
// - Otherwise, proxy to the original deployed host so the UI keeps working.
const useRealApi = String(process.env.USE_REAL_API || '').toLowerCase() === 'true';
const geminiKey = process.env.GEMINI_API_KEY;

if (useRealApi && geminiKey) {
  const googleTarget = 'https://generative.googleapis.com';
  console.log('Using real Google Generative API as /api-proxy target');
  app.use('/api-proxy', createProxyMiddleware({
    target: googleTarget,
    changeOrigin: true,
    // keep path as-is after /api-proxy so client can call e.g. /api-proxy/v1/...
    pathRewrite: { '^/api-proxy': '' },
    onProxyReq: (proxyReq, req, res) => {
      // Add Authorization header for Google API
      proxyReq.setHeader('Authorization', `Bearer ${geminiKey}`);
      // Optionally set Content-Type if missing
      if (!proxyReq.getHeader('Content-Type') && req.headers['content-type']) {
        proxyReq.setHeader('Content-Type', req.headers['content-type']);
      }
    },
    onError: (err, req, res) => {
      console.error('Proxy->Google API error', err && err.message);
      res.status(502).send('Bad gateway');
    }
  }));
} else {
  const fallback = 'https://gemini-icp-agent-331741607708.us-west1.run.app';
  console.log('Using fallback proxy target (original host) for /api-proxy');
  app.use('/api-proxy', createProxyMiddleware({
    target: fallback,
    changeOrigin: true,
    pathRewrite: { '^/api-proxy': '/api-proxy' },
    onError: (err, req, res) => {
      console.error('Proxy error', err && err.message);
      res.status(502).send('Bad gateway');
    }
  }));
}

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`gemini-agent server running on http://localhost:${port}`);
});
