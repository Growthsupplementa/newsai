const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 3000;

const staticDir = path.join(__dirname);
app.use(express.static(staticDir));

// Proxy /api-proxy to the original host if reachable
const target = 'https://gemini-icp-agent-331741607708.us-west1.run.app';
app.use('/api-proxy', createProxyMiddleware({
  target,
  changeOrigin: true,
  pathRewrite: { '^/api-proxy': '/api-proxy' },
  onError: (err, req, res) => {
    console.error('Proxy error', err && err.message);
    res.status(502).send('Bad gateway');
  }
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`gemini-agent server running on http://localhost:${port}`);
});
