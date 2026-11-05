# Riddle Quest

## Deploying on Render

Create or open the app's **Web Service** in Render and configure:

- **Build command:** `npm ci`
- **Start command:** `npm start`
- **Environment variable:** `OPENROUTER_API_KEY` with your OpenRouter key

Set the key under **Dashboard → your service → Environment**. Do not commit the key or put it in `render.yaml`; the local `.env` file is ignored by Git and is not deployed. After saving the variable, redeploy the service so the server reads it at startup.

The admin dashboard's AI status shows whether the server has a key configured. If it reports that no key is configured, check the variable name and redeploy. Render startup logs also warn when the variable is missing.

The `.node-version` file selects Node.js 22, which provides the built-in `fetch` used to call OpenRouter.
