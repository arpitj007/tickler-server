# Troubleshooting

Start with the health check: open your server address with `/api/health` at the end, in a browser. If you see `"ok": true`, your server is running and reachable from that device.

## Deploying

### The Cloudflare build failed

Open **Workers & Pages** in the Cloudflare dashboard, then your `tickler` Worker, then **Deployments**, and read the build log.

- **"Authentication" or "repository" errors:** reconnect GitHub in Cloudflare and press **Retry build**.
- **A D1 or migration error:** make sure the D1 database exists and is bound to the Worker (the Deploy button does this). Then retry.
- Still stuck? Copy the last 30 lines of the log into a [GitHub Discussion](https://github.com/arpitj007/tickler-server/discussions).

### Docker: the container keeps restarting

Run `docker logs tickler`. Common causes:

- **`TICKLER_SECRET` is missing:** add it (see [Deploy with Docker](/guides/deploy-docker)).
- **Permission denied on `/data`:** the folder you mounted isn't writable. On Linux, try `sudo chown -R 1000:1000 data`.
- **Port already in use:** something else uses 8787. Change the left side of the port mapping, like `"8788:8787"`.

### I'm locked out of `/setup`

- **Lost passkey:** use your passphrase if you set one. Add a new passkey after logging in.
- **Lost both:** whoever controls the hosting can reset the admin login; your entries are kept. The exact command for Docker and for Cloudflare is in the server's README under "Reset the admin login".

## Pairing

| Message | Fix |
| --- | --- |
| Code expired | Codes last 10 minutes. Press **Pair a phone** again. |
| Code not found | Typo, or the code was already used. Make a new one. |
| Can't reach the server | The phone can't reach the address. On home Wi-Fi? Server running? For use away from home, set up a [public address](/guides/public-url-cloudflare-tunnel). |
| Too many tries | Wait a minute. |
| Certificate error | The address uses `https://` but has no valid certificate. Use the Tunnel or Funnel address, or `http://` on your home network. |

## AI tools

### The tool says it can't connect

1. Open `<your server>/api/health` on the same computer. If that fails, it's a network problem, not a Tickler problem.
2. Make sure the URL ends in `/mcp`.
3. The Claude apps and ChatGPT connect from the cloud: your server needs a public HTTPS address.

### "Unauthorized" or "401"

The token is wrong or was revoked. Make a new one (setup, then **AI tools**, then **New token**) and update the tool's config. Check there's exactly one space between `Bearer` and the token.

### The agent never adds entries by itself

It has the tools but doesn't know when to use them. Add the [instruction block](/guides/instruction-block) to `CLAUDE.md`, `AGENTS.md` or your tool's rules.

### Entries show "unknown origin"

- **Claude Code:** the [origin hook](/guides/connect/claude-code#step-3-install-the-origin-hook-recommended) isn't running. Check the path in `~/.claude/settings.json`, that Node.js 20+ is installed, and restart Claude Code.
- **Other tools:** add the instruction block, which asks the model to pass its origin.

### Duplicate entries

Agents should use a stable `external_key` so re-runs update the same entry. The instruction block asks for this; if your tool ignores it, add "always set external_key" to your rules.

### "Rate limited"

A token can write 60 times a minute. That usually means an agent is stuck in a loop. Check the **Activity log** to see which session.

## The app

### New entries don't show up

Pull down to refresh. The app syncs on every open and about hourly in the background. If refresh fails, check `/api/health` from the phone's browser.

### Notifications don't arrive

See [Notifications](/guides/notifications#making-it-as-reliable-as-possible): allow notifications, keep Background App Refresh on (iPhone), allow exact alarms and unrestricted battery (Android).

### Times look wrong

Agents should send times in UTC plus a `timezone`. If an agent sent local time as UTC, the entry is off by your UTC offset. Add "times in UTC" to your instructions, or fix the entry in the app.

## Money

### A provider says "Needs a public URL"

Webhooks need your server to be reachable from the internet. On Docker, set up [Cloudflare Tunnel](/guides/public-url-cloudflare-tunnel) or [Tailscale Funnel](/guides/public-url-tailscale-funnel), and set `TICKLER_PUBLIC_URL`.

### Test fails with a permission error

The key is missing a permission. Each provider's guide lists the exact read-only permissions. Create a new key with those and paste it again.

### Numbers look old

Check the **as of** time and the source's usual delay in [Money](/guides/money#how-fresh-are-the-numbers). App Store and Google Play reports are about a day behind by design.
