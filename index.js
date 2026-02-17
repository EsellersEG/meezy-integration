require('dotenv').config();
const express = require('express');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { LATEST_API_VERSION } = require('@shopify/shopify-api');

const app = express();

console.log('--- Environment Check ---');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'Present' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'Present' : 'MISSING');
console.log('HOST:', process.env.HOST);
console.log('-------------------------');

const shopify = shopifyApp({
  api: {
    apiVersion: '2024-10', // Updated to latest stable
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SHOPIFY_API_SCOPES?.split(','),
    hostName: process.env.HOST?.replace(/https?:\/\//, ''),
    isEmbeddedApp: false, // Set to false to allow direct browser access
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
});

// Add a simple health check for Railway
app.get('/', (req, res) => res.send('Meezy App is Live!'));

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
    // This is where we get the offline token
    const session = res.locals.shopify.session;
    console.log('Successfully authorized!', session.shop);
    console.log('Permanent Access Token:', session.accessToken);

    res.send(`
      <html>
        <head><title>Meezy Integration App</title></head>
        <body style="font-family: sans-serif; padding: 20px;">
          <h1>Successfully Connected!</h1>
          <p>Store: <strong>${session.shop}</strong></p>
          <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; border: 1px solid #ddd;">
            <p>Your Permanent Access Token is:</p>
            <code style="display: block; word-break: break-all; background: #fff; padding: 10px; border: 1px solid #ccc;">
              ${session.accessToken}
            </code>
          </div>
          <p style="color: #666; margin-top: 20px;">
            Copy this token and use it in your Meezy App Script.
          </p>
        </body>
      </html>
    `);
  }
);

app.use(shopify.cspHeaders());
app.use(express.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Meezy Integration App running on port ${PORT}`);
});
