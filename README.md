# Meezy Integration App

Meezy Integration is a Shopify embedded app that connects your Shopify store to the Meezy platform, enabling seamless product, inventory, and order synchronization.

## Setup
1. Create a new app in your [Shopify Partner Dashboard](https://partners.shopify.com/2496035).
2. Get the **Client ID** and **Client Secret**.
3. Create a `.env` file from `.env.example` and fill in your credentials.
4. Host the app on **Railway** or a similar platform.
5. In the Partner Dashboard app settings, set the **App URL** and **Redirect URI** to your hosted URL.

## Configuration (.env)
- `SHOPIFY_API_KEY`: Your Client ID
- `SHOPIFY_API_SECRET`: Your Client Secret
- `APP_URL`: The URL where your app is hosted (e.g. `https://your-app.up.railway.app`)
