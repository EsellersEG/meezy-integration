# Meezy Integration App

This app is designed to help you generate **permanent** Shopify Admin API Access Tokens for your clients.

## How to use:
1. Create a new App in your [Shopify Partner Dashboard](https://partners.shopify.com/2496035).
2. Get the **Client ID** and **Client Secret**.
3. Create a `.env` file from the `.env.example` and paste your credentials.
4. Run the app using `node index.js`.
5. Use a service like **Railway** or **Render** to host this app.
6. Once hosted, go to your app settings in the Partner Dashboard and set the **Redirect URI** to:
   `https://your-app-url.com/api/auth/callback`
7. Install the app on your client's store using the installation link.
8. The app will display the **Permanent Access Token** on your screen after installation.

## Configuration (.env)
- `SHOPIFY_API_KEY`: Your Client ID
- `SHOPIFY_API_SECRET`: Your Client Secret
- `HOST`: The URL where your app is hosted
