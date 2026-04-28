require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { shopifyApp } = require('@shopify/shopify-app-express');

const app = express();
app.set('trust proxy', true); // CRITICAL: Fixes the 0.0.0.0 redirect issue on Railway

console.log('--- Environment Check ---');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'Present' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'Present' : 'MISSING');
console.log('APP_URL:', process.env.APP_URL || process.env.HOST);
console.log('-------------------------');

const appUrl = (process.env.APP_URL && process.env.APP_URL !== '0.0.0.0')
  ? process.env.APP_URL
  : (process.env.HOST !== '0.0.0.0' ? process.env.HOST : '');

const appHost = appUrl?.replace(/https?:\/\//, '').replace(/\/$/, '');
console.log('Using Redirect Host:', appHost);

const shopify = shopifyApp({
  api: {
    apiVersion: '2025-01',
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_orders'],
    hostName: appHost,
    isEmbeddedApp: false,
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
});

// ─── HMAC Verification Helper ───────────────────────────────────────────────
// Verifies the x-shopify-hmac-sha256 header on incoming webhook requests.
// Uses timing-safe comparison to prevent timing attacks.
function verifyShopifyWebhook(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) return false;
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(req.body)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac));
  } catch {
    return false;
  }
}

// ─── Premium HTML Template ───────────────────────────────────────────────────
const showTokenPage = (shop, token) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meezy Integration | Success</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent: #22d3ee;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg);
            color: var(--text-main);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: var(--card-bg);
            padding: 40px;
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            max-width: 500px;
            width: 100%;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
        }
        .icon { font-size: 48px; margin-bottom: 20px; display: block; }
        h1 {
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 10px;
            background: linear-gradient(to right, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p { color: var(--text-muted); margin-bottom: 30px; font-size: 16px; }
        .shop-badge {
            display: inline-block;
            background: rgba(99, 102, 241, 0.1);
            color: var(--accent);
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 14px;
            margin-bottom: 24px;
            border: 1px solid rgba(34, 211, 238, 0.2);
        }
        .token-box {
            position: relative;
            background: #000;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #334155;
            text-align: left;
            margin-bottom: 20px;
        }
        .token-label {
            font-size: 12px;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 8px;
            letter-spacing: 0.05em;
        }
        code {
            display: block;
            word-break: break-all;
            font-family: 'Courier New', monospace;
            color: var(--accent);
            font-size: 14px;
            line-height: 1.5;
        }
        .footer-note { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
        .highlight { color: var(--primary); font-weight: 600; }
    </style>
</head>
<body>
    <div class="card">
        <span class="icon">✅</span>
        <h1>Connection Successful</h1>
        <div class="shop-badge">${shop}</div>
        <div class="token-box">
            <div class="token-label">Permanent Admin Access Token</div>
            <code>${token}</code>
        </div>
        <p class="footer-note">
            Copy this token and paste it into your <span class="highlight">Meezy App Script</span>.<br>
            This is a permanent token and will not expire.
        </p>
    </div>
</body>
</html>
`;

// ─── Install HTML Template ─────────────────────────────────────────────────────
const showInstallPage = () => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meezy Integration | Install</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent: #22d3ee;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg);
            color: var(--text-main);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: var(--card-bg);
            padding: 40px;
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            max-width: 500px;
            width: 100%;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
        }
        h1 {
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 10px;
            background: linear-gradient(to right, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p { color: var(--text-muted); margin-bottom: 30px; font-size: 16px; }
        input[type="text"] {
            width: 100%;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid #334155;
            background: #000;
            color: var(--text-main);
            font-size: 16px;
            margin-bottom: 20px;
            box-sizing: border-box;
        }
        button {
            background: var(--primary);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: background 0.3s;
            font-family: 'Outfit', sans-serif;
        }
        button:hover {
            background: var(--primary-dark);
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>Connect to Meezy</h1>
        <p>Enter your Shopify store domain to authorize the app and generate your access token.</p>
        <form action="/api/auth" method="GET">
            <input type="text" name="shop" placeholder="e.g. your-store.myshopify.com" required>
            <button type="submit">Connect Store</button>
        </form>
    </div>
</body>
</html>
`;

// ─── Root Route ──────────────────────────────────────────────────────────────
// FIX: When Shopify visits the app URL with install params (shop + hmac),
// we MUST redirect to /api/auth to start the OAuth flow.
// Without this redirect, the "Immediately authenticates after install" check fails.
app.get('/', async (req, res) => {
  const { shop, hmac, host } = req.query;

  if (shop && hmac) {
    // Shopify is sending the merchant to install the app — initiate OAuth
    const params = new URLSearchParams({ shop });
    if (host) params.append('host', host);
    return res.redirect(`/api/auth?${params.toString()}`);
  }

  // Show the token if already authenticated with this shop
  if (shop) {
    const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
    if (sessions.length > 0) {
      console.log('Returning stored token for', shop);
      return res.send(showTokenPage(shop, sessions[0].accessToken));
    }
  }

  res.send(showInstallPage());
});

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.get('/api/auth', (req, res, next) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter. URL should be: /api/auth?shop=storename.myshopify.com');
  }
  console.log('Initiating auth for shop:', shop);
  next();
}, shopify.auth.begin());

app.get(
  '/api/auth/callback',
  shopify.auth.callback(),
  async (req, res) => {
    const session = res.locals.shopify.session;
    console.log('Successfully authorized!', session.shop);
    console.log('Permanent Access Token generated.');
    res.send(showTokenPage(session.shop, session.accessToken));
  }
);

// ─── Mandatory GDPR Compliance Webhooks ──────────────────────────────────────
// Shopify REQUIRES these three endpoints for all apps in the App Store.
// Each endpoint MUST verify the x-shopify-hmac-sha256 signature.
// express.raw() is used so req.body is a Buffer for HMAC calculation.

app.post('/webhooks/customers/redact',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      console.warn('[Webhook] customers/redact: Invalid HMAC — rejected');
      return res.status(401).send('Unauthorized');
    }
    console.log('[Webhook] customers/redact received');
    // TODO: Delete customer data from your systems
    res.status(200).send('OK');
  }
);

app.post('/webhooks/shop/redact',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      console.warn('[Webhook] shop/redact: Invalid HMAC — rejected');
      return res.status(401).send('Unauthorized');
    }
    console.log('[Webhook] shop/redact received');
    // TODO: Delete all shop data from your systems
    res.status(200).send('OK');
  }
);

app.post('/webhooks/customers/data_request',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      console.warn('[Webhook] customers/data_request: Invalid HMAC — rejected');
      return res.status(401).send('Unauthorized');
    }
    console.log('[Webhook] customers/data_request received');
    // TODO: Return customer data from your systems
    res.status(200).send('OK');
  }
);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(shopify.cspHeaders());
app.use(express.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Meezy Integration App running on port ${PORT}`);
});
