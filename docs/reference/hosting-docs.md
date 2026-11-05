# Hosting these docs

This site is built with VitePress from the `docs/` folder of `tickler-server`. It has its own `package.json`, separate from the server.

## Build locally

```
cd docs
npm install
npm run docs:dev      # live preview at http://localhost:5173
npm run docs:build    # static site in docs/.vitepress/dist
npm run docs:preview  # serve the built site
```

## The one setting to change: the site address

The public address is one value at the top of `docs/.vitepress/config.ts`:

```ts
export const SITE_URL = (process.env.DOCS_SITE_URL ?? 'https://docs.gettickler.com')
```

It's used for the sitemap and canonical links. Change the default when the domain is decided, or set `DOCS_SITE_URL` in the hosting build settings (handy for a `pages.dev` address before the domain exists).

## Cloudflare Pages

1. Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, pick `tickler-server`.
2. Build settings:

| Setting | Value |
| --- | --- |
| Framework preset | None (or VitePress, then adjust the fields below) |
| Root directory | `docs` |
| Build command | `npm install && npm run docs:build` |
| Build output directory | `.vitepress/dist` |
| Environment variable | `NODE_VERSION` = `22` |
| Environment variable (optional) | `DOCS_SITE_URL` = the address you'll use |

3. Save and deploy. The site appears at `https://<project>.pages.dev`.
4. Custom domain: in the Pages project, **Custom domains**, **Set up a domain**, enter `docs.gettickler.com`. Add it here first; a hand-made CNAME alone fails with error 522. A subdomain can point (CNAME) to `<project>.pages.dev` from any DNS provider; an apex domain must be a zone on Cloudflare.
5. Optional: under **Settings**, **Builds**, set **Build watch paths** to `docs/**` so server-only commits don't rebuild the site.

Note: Cloudflare now suggests Workers (with static assets) for new projects. Pages still works and is the simplest for a static VitePress site; moving later is easy because the output is plain static files.

## What not to add

No analytics or tracking scripts. The privacy policy says the site has none, and that's part of the promise.

## The in-app guides

Files in `docs/guides/` are also bundled into the apps. See [In-app guide format](./guides-format.md) before editing them.

Sources for these instructions are listed in [Sources checked](./sources.md).
