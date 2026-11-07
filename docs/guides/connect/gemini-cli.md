# Connect Gemini CLI

**Time:** about 2 minutes.

**Fastest:** in the Tickler app, open **AI tools** and paste the one-line command into a terminal on this computer. It sets up Gemini CLI and its instructions for you. The steps below are the same thing by hand.

## Step 1: Add the Tickler server

Run:

```
gemini mcp add --transport http --scope user --header "Authorization: Bearer {{MCP_TOKEN}}" tickler {{SERVER_URL}}/mcp
```

The token (it starts with `tkm_`) is a key just for Gemini CLI. In the Tickler app it's filled in for you. Otherwise make one on your server's setup page under **AI tools**, then **New token**.

### Or edit the settings file

Open `~/.gemini/settings.json` and add the `tickler` part to `"mcpServers"`:

```json
{
  "mcpServers": {
    "tickler": {
      "httpUrl": "{{SERVER_URL}}/mcp",
      "headers": {
        "Authorization": "Bearer {{MCP_TOKEN}}"
      }
    }
  }
}
```

Use `httpUrl`, not `url`: `httpUrl` is the modern HTTP connection Tickler speaks.

## Step 2: Check it's connected

Start `gemini` and type `/mcp`. Tickler should be listed as connected, with its tools.

## Step 3: Tell Gemini when to use it

Add the [instruction block](../instruction-block.md) to `~/.gemini/GEMINI.md`.

## Step 4: Try it

```
Add a Tickler entry for tomorrow at 16:00: check the nightly build, project CI.
```
