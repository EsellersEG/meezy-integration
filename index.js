require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { PostgreSQLSessionStorage } = require('@shopify/shopify-app-session-storage-postgresql');
const { GraphqlQueryError } = require('@shopify/shopify-api');

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
</body>
</html>
`;



// ─── Root Route (Embedded App Entry Point) ───────────────────────────────────
// ensureInstalledOnShop automatically:
//   - Redirects to OAuth if the shop hasn't installed the app yet
//   - Validates the session if already installed
//   - Populates res.locals.shopify.session on success
app.get('/', shopify.ensureInstalledOnShop(), async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop || req.query.shop;

  // ─── Billing Check ────────────────────────────────────────────────────────
  // Shopify requires all public apps to go through the Billing API.
  // We offer a Free plan at $0. If the merchant has no active subscription,
  // we create one and redirect them to the confirmation URL.
  try {
    const client = new shopify.api.clients.Graphql({ session });

    // Check for an existing active subscription
    const existingResponse = await client.request(`{
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
        }
      }
    }`);

    const activeSubscriptions =
      existingResponse?.data?.currentAppInstallation?.activeSubscriptions ?? [];

    if (activeSubscriptions.length === 0) {
      // No active plan — create the free $0 subscription
      const returnUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
      const createResponse = await client.request(
        `mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
          appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, test: $test) {
            appSubscription { id status }
            confirmationUrl
            userErrors { field message }
          }
        }`,
        {
          variables: {
            name: 'Meezy Free Plan',
            returnUrl,
            test: process.env.NODE_ENV !== 'production',
            lineItems: [
              {
                plan: {
                  appRecurringPricingDetails: {
                    price: { amount: 0.0, currencyCode: 'USD' },
                    interval: 'EVERY_30_DAYS',
                  },
                },
              },
            ],
          },
        }
      );

      const { confirmationUrl, userErrors } =
        createResponse?.data?.appSubscriptionCreate ?? {};

      if (userErrors?.length) {
        console.error('[Billing] userErrors:', userErrors);
      }

      if (confirmationUrl) {
        // Redirect merchant to Shopify's billing confirmation page
        return res.redirect(confirmationUrl);
      }
    }
  } catch (e) {
    // Log but don't block the merchant — if billing check fails just show the dashboard
    if (e instanceof GraphqlQueryError) {
      console.error('[Billing] GraphQL error:', e.response);
    } else {
      console.error('[Billing] Unexpected error:', e.message);
    }
  }

  res.send(showEmbeddedDashboard(shop));
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
    const { shop } = res.locals.shopify.session;
    const host = req.query.host;
    console.log(`[Auth] Token saved for: ${shop}`);
    // Redirect to the embedded app inside Shopify Admin
    return res.redirect(`/?shop=${shop}&host=${host}`);
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
