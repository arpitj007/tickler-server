# Connect Cursor

**Time:** about 2 minutes.

## Step 1: Add Tickler to Cursor's MCP settings

Open (or create) the file `~/.cursor/mcp.json` in your home folder. You can also get there from Cursor: **Settings**, then **MCP**, then **Add new global MCP server**.

Paste this. If the file already has an `"mcpServers"` section, add just the `"tickler"` part inside it:

```json
{
  "mcpServers": {
    "tickler": {
      "url": "{{SERVER_URL}}/mcp",
      "headers": {
        "Authorization": "Bearer {{MCP_TOKEN}}"
      }
    }
  }
}
```

The token (it starts with `tkm_`) is a key just for Cursor. In the Tickler app it's filled in for you. Otherwise make one on your server's setup page under **AI tools**, then **New token**.

To keep the token out of the file, put `"Bearer ${env:TICKLER_TOKEN}"` there instead and set `TICKLER_TOKEN` in your shell profile.

Want Tickler in one project only? Use `.cursor/mcp.json` inside that project instead. Don't commit a file that contains the token.

## Step 2: Check it's connected

In Cursor, open **Settings**, then **MCP**. Tickler should show a green dot and its list of tools. If it's red, press the refresh button next to it.

## Step 3: Tell Cursor when to use it

Add the [instruction block](../instruction-block.md) under **Settings**, then **Rules**, then **User Rules**.

## Step 4: Try it

In Cursor's chat (Agent mode), ask:

```
Add a Tickler entry: re-run the migration check next Monday at 09:00, project Backend.
```

Cursor may ask you to approve the tool call the first time.

## Origins from Cursor

Cursor doesn't pass a session id to MCP servers automatically, so the instruction block asks the model to include what it knows: the project folder, the branch and a short title. Entries show Cursor's icon and that title.
