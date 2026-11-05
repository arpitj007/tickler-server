# Connect Codex

This works for the Codex CLI and the Codex IDE extension, which share the same settings file.

**Time:** about 2 minutes.

## Step 1: Add Tickler to your Codex config

Open (or create) `~/.codex/config.toml` and add:

```toml
[mcp_servers.tickler]
url = "{{SERVER_URL}}/mcp"
http_headers = { "Authorization" = "Bearer {{MCP_TOKEN}}" }
```

The token (it starts with `tkm_`) is a key just for Codex. In the Tickler app it's filled in for you. Otherwise make one on your server's setup page under **AI tools**, then **New token**.

### Keep the token out of the file (optional)

Use an environment variable instead:

```toml
[mcp_servers.tickler]
url = "{{SERVER_URL}}/mcp"
bearer_token_env_var = "TICKLER_TOKEN"
```

Then add `export TICKLER_TOKEN="{{MCP_TOKEN}}"` to your shell profile (`~/.zshrc` or `~/.bashrc`) and open a new terminal.

### Or sign in with OAuth

Leave out the token lines entirely and run:

```
codex mcp login tickler
```

A browser opens on your own server's login page. Log in with your passkey or passphrase and press **Allow**.

## Step 2: Check it's connected

```
codex mcp list
```

Tickler should be listed. In a Codex session, `/mcp` shows its tools.

## Step 3: Tell Codex when to use it

Add the [instruction block](../instruction-block.md) to `~/.codex/AGENTS.md` (every project) or to `AGENTS.md` in one project.

## Step 4: Try it

```
codex "Add a Tickler entry for the 1st of next month at 09:00: renew the staging certificate, project Infra, important."
```

## Origins from Codex

The instruction block asks Codex to include its session id. To resume a session from an entry, copy the id from the origin card and run `codex resume` with it.
