# Tickler server

Your AI agents keep saying "I'll do that later." Tickler makes sure later happens.

This is the small server you run yourself. Your agents (Claude Code, the Claude apps, Cursor,
Codex, ChatGPT, Gemini CLI, anything that speaks MCP) write follow-ups, deadlines, launches and
scheduled runs to it, each one linked back to the chat or session that created it. The Tickler
app on your phone shows them on a timeline, together with what your apps earn and your services
cost. Your data stays on your server; we never see it.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/arpitj007/tickler-server)

## Quick start

### Cloudflare (recommended, free tier)

1. Click **Deploy to Cloudflare** above. It creates the Worker and a D1 database in your own
   Cloudflare account. When it asks for `TICKLER_SECRET`, paste a long random value
   (`openssl rand -base64 32`) and keep a copy.
2. Open `https://<your-worker>.workers.dev/setup`, enter the secret once to claim the server, and
   choose an admin passphrase. You can add a passkey afterwards.
3. **Pair a phone**: scan the QR code with the Tickler app.
4. **AI tools**: create a token and copy the snippet for your tool.

The Worker applies database migrations itself on first use, and Cron Triggers run the money
syncs (every 15 minutes) and the daily job (06:00 UTC).

### Docker

```sh
docker run -d --name tickler -p 8787:8787 -v tickler:/data ghcr.io/arpitj007/tickler-server
docker logs tickler    # shows the generated TICKLER_SECRET on first start
```

Then open <http://localhost:8787/setup>. Or with compose:

```sh
curl -fsSLO https://raw.githubusercontent.com/arpitj007/tickler-server/main/docker-compose.yml
docker compose up -d
docker compose logs tickler
```

Data lives in the `/data` volume (`tickler.sqlite` and the generated `secret`). For phones away
from home, cloud MCP clients and store webhooks you need a public https URL: see the
[Cloudflare Tunnel / Tailscale Funnel guide](docs/guides/deploy-docker.md), then set
`TICKLER_PUBLIC_URL`.

### Connect Claude Code

```sh
claude mcp add --transport http tickler https://<your-server>/mcp \
  --header "Authorization: Bearer <token from /setup>" --scope user
```

Install the [origin hook](hooks/claude-code/README.md) so each entry links back to its session
with a working `claude --resume` command. Other clients: [docs/guides/connect](docs/guides/connect/).
The Claude apps and ChatGPT connect with OAuth: add `https://<your-server>/mcp` as a custom
connector and sign in with your admin passphrase or passkey.

Add the [instruction block](docs/guides/instruction-block.md) to your `CLAUDE.md`, `AGENTS.md` or
Cursor rules.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `TICKLER_SECRET` | required (Docker: generated into `/data/secret`) | Encrypts provider keys (AES-GCM, HKDF); proves ownership on first setup |
| `TICKLER_PUBLIC_URL` | from the request | Public base URL, used in the QR code, OAuth metadata and webhook URLs |
| `TICKLER_SERVER_NAME` | `Tickler` | Shown in the app, e.g. `Personal` or `Work` |
| `TICKLER_CURRENCY` | `USD` | Base currency for money totals |
| `TICKLER_DATA_DIR` | `/data` | Docker/Node only |
| `TICKLER_DEMO_PAIRING_CODE` | unset | Review/demo servers only: a pairing code that never expires |

### Forgot the admin passphrase

This removes the admin login and passkeys (not your data); then claim `/setup` again with your
`TICKLER_SECRET`.

```sh
docker exec tickler node dist/node.js reset-admin                    # Docker
npm run reset-admin                                                  # from a checkout
npx wrangler d1 execute DB --remote --command "DELETE FROM admin; DELETE FROM passkeys; DELETE FROM sessions;"   # Cloudflare
```

## What's inside

- `/mcp`: MCP server (streamable HTTP, stateless). Tools: `create_entry`, `update_entry`,
  `complete_entry`, `delete_entry`, `list_entries`, `list_projects`, `create_project`,
  `mark_important`, `list_origins`, `get_money_summary`. Bearer tokens or OAuth 2.1.
- `/api/*`: JSON API for the apps ([contract](docs/reference/api-contract.md)).
- `/setup`: admin pages (passphrase or passkey), pairing QR, devices, tokens, money sources.
- `/oauth/*`, `/.well-known/*`: OAuth 2.1 authorization server (PKCE, dynamic client
  registration, client ID metadata documents).
- `/hooks/<store>`: App Store, Google Play, Amazon and Stripe webhooks.
- One TypeScript codebase (Hono) for both runtimes: D1 on Cloudflare, SQLite on Docker, same
  `migrations/`.

## Development

```sh
npm install
npm run dev:node        # Node + SQLite on http://localhost:8787 (data in ./data)
npm run dev             # wrangler dev with a local D1 (put TICKLER_SECRET in .dev.vars)
npm test                # Vitest, Node + SQLite
npm run test:workers    # Vitest in workerd with D1
npm run typecheck
npm run seed -- generate   # rebuild seed/demo-changes.json
npm run seed -- load       # load demo data into ./data/tickler.sqlite
sh scripts/smoke.sh http://localhost:8787 "$TICKLER_SECRET"   # end-to-end check of a fresh server
```

Node 22.13 or newer (uses the built-in `node:sqlite`).

## Docs

Full guides: [docs/](docs/index.md): [quick start](docs/quick-start.md),
[Cloudflare](docs/guides/deploy-cloudflare.md), [Docker](docs/guides/deploy-docker.md),
[connect your AI tools](docs/connect.md), [money providers](docs/providers/index.md),
[security](docs/security.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE).
