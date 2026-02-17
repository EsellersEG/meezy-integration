require('dotenv').config();
const express = require('express');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { LATEST_API_VERSION } = require('@shopify/shopify-api');

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
    apiVersion: '2024-10',
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    // Matching exactly what you have in the Dashboard now:
    scopes: ['write_inventory', 'read_inventory', 'read_products', 'write_products'],
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

// Premium HTML Template for showing the token
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
        .icon {
            font-size: 48px;
            margin-bottom: 20px;
            display: block;
        }
        h1 {
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 10px;
            background: linear-gradient(to right, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            color: var(--text-muted);
            margin-bottom: 30px;
            font-size: 16px;
        }
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
        .footer-note {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.6;
        }
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

// Root route: Show token if authenticated, otherwise basic health check
app.get('/', async (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    // Look for existing session in memory
    const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
    if (sessions.length > 0) {
      console.log('Returning stored token for', shop);
      return res.send(showTokenPage(shop, sessions[0].accessToken));
    }
  }
  res.send('<h1>Meezy App is Live!</h1><p>Please use the installation link provided.</p>');
});

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

app.use(shopify.cspHeaders());
app.use(express.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Meezy Integration App running on port ${PORT}`);
});
