<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/706aacad-208d-487f-9c73-3b2c0999d11e

## Run Locally (No Tailscale Required)

**Prerequisites:** Node.js, Python (for wallet balance), HWiNFO64 (with Shared Memory enabled)

The dashboard runs **localhost-only** by default — no Tailscale or Caddy needed.

1. Install dependencies:
   `npm install`
2. Configure `.env` with your Telegram credentials (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`)
3. Run the app:
   `npm run dev`
4. Open **http://127.0.0.1:3000** in your browser

The server binds to `127.0.0.1` so it's only reachable from this machine. Nothing leaves your network.

### Optional: Remote access via Tailscale

If you later want to access the dashboard from outside your home network, the included `Caddyfile` is pre-configured for Tailscale. See the comments at the top of `Caddyfile` for setup steps. This is **completely optional** — you don't need it for local use.
