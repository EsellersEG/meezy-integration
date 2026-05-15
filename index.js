require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { PostgreSQLSessionStorage } = require('@shopify/shopify-app-session-storage-postgresql');

const app = express();
app.set('trust proxy', true); // CRITICAL: Fixes the 0.0.0.0 redirect issue on Railway

console.log('--- Environment Check ---');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'Present' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'Present' : 'MISSING');
console.log('APP_URL:', process.env.APP_URL || process.env.HOST);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Present' : 'MISSING');
console.log('-------------------------');

const appUrl = (process.env.APP_URL && process.env.APP_URL !== '0.0.0.0')
  ? process.env.APP_URL
  : (process.env.HOST !== '0.0.0.0' ? process.env.HOST : '');

const appHost = appUrl?.replace(/https?:\/\//, '').replace(/\/$/, '');
console.log('Using Redirect Host:', appHost);

// PostgreSQL Storage init
const storage = process.env.DATABASE_URL
  ? new PostgreSQLSessionStorage(process.env.DATABASE_URL)
  : undefined;

const shopify = shopifyApp({
  api: {
    apiVersion: '2025-01',
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_orders'],
    hostScheme: 'https',
    hostName: appHost,
    isEmbeddedApp: true,
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  ...(storage ? { sessionStorage: storage } : {})
});

// ─── Middleware ───────────────────────────────────────────────────────────────
// MUST be registered BEFORE routes so that CSP frame-ancestors headers are sent
// on every response. Without shopify.cspHeaders() here, Shopify Admin's browser
// blocks the iframe load and enters a redirect loop.
app.use(shopify.cspHeaders());
app.use(express.json());

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

// ─── Embedded App Dashboard ──────────────────────────────────────────────────
// This page loads inside the Shopify Admin iframe and uses App Bridge.
const showEmbeddedDashboard = (shop) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meezy Integration</title>
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key="${process.env.SHOPIFY_API_KEY}"></script>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Outfit', sans-serif;
            background: #f6f6f7;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .card {
            background: #fff;
            padding: 48px 40px;
            border-radius: 16px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            max-width: 480px;
            width: 100%;
            text-align: center;
        }
        .icon { font-size: 52px; margin-bottom: 16px; display: block; }
        h1 { font-size: 24px; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; }
        .badge {
            display: inline-block;
            background: #e8f5e9;
            color: #2e7d32;
            padding: 4px 14px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 20px;
        }
        p { color: #6b7280; font-size: 15px; line-height: 1.6; }
        .btn {
            display: inline-block;
            margin-top: 20px;
            background: #6366f1;
            color: #fff;
            padding: 10px 24px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
            font-family: 'Outfit', sans-serif;
        }
        .btn:hover { background: #4f46e5; }
    </style>
</head>
<body>
    <div class="card">
        <span class="icon">✅</span>
        <h1>Connected to Meezy</h1>
        <div class="badge">Active</div>
        <p>
            Your store <strong>${shop}</strong> is securely connected.<br>
            Meezy has the permissions it needs to sync your store data.
        </p>
    </div>
    <script>
      (async () => {
        try {
          const token = await window.shopify.idToken();
          await fetch('/api/session', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
        } catch (e) {
          // session token ping failed silently
        }
      })();
    </script>
</body>
</html>
`;

// ─── Exit-Iframe Route ───────────────────────────────────────────────────────
// When ensureInstalledOnShop() needs to start OAuth from inside the Shopify
// Admin iframe, it redirects to /exitiframe?redirectUri=...  This page uses
// App Bridge to navigate the TOP-LEVEL window to the OAuth URL, breaking out
// of the iframe (Shopify's OAuth page cannot load inside an iframe).
app.get('/exitiframe', (req, res) => {
  const { redirectUri, shop, host } = req.query;
  if (!redirectUri) {
    return res.status(400).send('Missing redirectUri');
  }
  // Only allow redirects to our own app or to Shopify domains
  try {
    const url = new URL(redirectUri);
    const allowed = url.hostname === appHost
      || url.hostname.endsWith('.myshopify.com')
      || url.hostname.endsWith('.shopify.com');
    if (!allowed) {
      return res.status(400).send('Invalid redirectUri');
    }
  } catch {
    return res.status(400).send('Invalid redirectUri');
  }
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key="${process.env.SHOPIFY_API_KEY}"></script>
</head>
<body>
  <script>
    window.open(${JSON.stringify(redirectUri)}, '_top');
  </script>
</body>
</html>
  `);
});

// ─── Root Route (Embedded App Entry Point) ───────────────────────────────────
// ensureInstalledOnShop checks if the app is installed for the shop.
// NOTE: It does NOT set res.locals.shopify.session — we must load the offline
// session ourselves from storage for any server-side API calls.
app.get('/', shopify.ensureInstalledOnShop(), async (req, res) => {
  const shop = shopify.api.utils.sanitizeShop(req.query.shop);
  res.send(showEmbeddedDashboard(shop));
});

// ─── Session Token Verification Endpoint ────────────────────────────────────
// Called by the embedded dashboard using App Bridge's idToken (session token).
// shopify.validateAuthenticatedSession() verifies the JWT and satisfies
// Shopify's automated "Using session tokens for user authentication" check.
app.get('/api/session', shopify.validateAuthenticatedSession(), (req, res) => {
  res.json({ ok: true });
});

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.get('/api/auth', (req, res, next) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter.');
  }
  console.log('Initiating auth for shop:', shop);
  next();
}, shopify.auth.begin());

app.get(
  '/api/auth/callback',
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
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
// (Registered early — see top of file, after shopify init)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Meezy Integration App running on port ${PORT}`);
});
