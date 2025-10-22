# Gemini ICP Agent (reconstructed)

This folder contains a reconstructed copy of the public client files scraped from the running app at https://gemini-icp-agent-331741607708.us-west1.run.app. It provides a minimal Express server to serve the saved static files and optionally proxy /api-proxy to the original host.

To run locally:

```bash
cd apps/gemini-agent
npm install
npm start
# then open http://localhost:3000
```

Notes:
- This is a best-effort reconstruction of the client only. Server-side source, secrets, and build config were not available from the public site.
- If you provide the original repo URL or access, I can preserve git history and integrate the app more fully.
