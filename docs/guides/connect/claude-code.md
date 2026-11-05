# Connect Claude Code

Claude Code is the best-tested Tickler client. This works the same in the terminal, the desktop app and the IDE extensions.

**Time:** about 3 minutes.

## Step 1: Add the Tickler server

Run this in a terminal:

```
claude mcp add --transport http --scope user tickler {{SERVER_URL}}/mcp --header "Authorization: Bearer {{MCP_TOKEN}}"
```

`--scope user` makes Tickler available in every project on this computer.

The token (it starts with `tkm_`) is a key just for this tool. In the Tickler app it's filled in for you. Otherwise make one on your server's setup page under **AI tools**, then **New token**. Name it after the computer, like "Claude Code on MacBook", so you can revoke it on its own later.

## Step 2: Check it's connected

```
claude mcp list
```

You should see `tickler` with **Connected** next to it. Inside a Claude Code session, `/mcp` shows the same, plus Tickler's tools.

## Step 3: Install the origin hook (recommended)

The hook lets every entry link back to the exact Claude Code session that created it, with a **resume command** you can copy from your phone. It fills in the session id, folder, git repo and branch, so the model doesn't have to guess.

Download the hook script to your Claude folder:

```
mkdir -p ~/.claude/hooks
curl -fsSL https://raw.githubusercontent.com/arpitj007/tickler-server/main/hooks/claude-code/tickler-origin.mjs -o ~/.claude/hooks/tickler-origin.mjs
```

Then open `~/.claude/settings.json` (create it if it doesn't exist) and add this. If the file already has a `"hooks"` section, add the `PreToolUse` item to it:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__tickler__.*",
        "hooks": [
          { "type": "command", "command": "node ~/.claude/hooks/tickler-origin.mjs" }
        ]
      }
    ]
  }
}
```

The hook only runs for Tickler's tools. It needs Node.js 20 or newer on this computer. It only reads your current folder, git remote, git branch and computer name, and adds them to the Tickler call. It sends nothing anywhere else.

Restart Claude Code after changing settings.

## Step 4: Tell Claude when to use Tickler

Add the [instruction block](../instruction-block.md) to `~/.claude/CLAUDE.md`. Without it, Claude only uses Tickler when you ask.

## Step 5: Try it

In any project, ask Claude Code:

```
Remind me tomorrow at 10:00 to check the review comments on this branch.
```

The entry appears in the app within a few seconds of the next sync. Open it: the origin card at the top shows this session, and **Copy resume command** gives you `cd ... && claude --resume ...`.

## Claude Code on the web

Sessions on the web run in the cloud, so they can only reach a server with a public address. Add Tickler to the repo's `.mcp.json` and keep the token out of the file:

```json
{
  "mcpServers": {
    "tickler": {
      "type": "http",
      "url": "{{SERVER_URL}}/mcp",
      "headers": { "Authorization": "Bearer ${TICKLER_TOKEN}" }
    }
  }
}
```

Then set `TICKLER_TOKEN` as an environment variable in your cloud environment's settings. The origin hook works there too if you commit it to the repo's `.claude/settings.json`.

## Troubleshooting

- **"Failed to connect":** open `{{SERVER_URL}}/api/health` in a browser. If that doesn't load, the computer can't reach your server.
- **"Unauthorized":** the token was revoked or mistyped. Remove and add again: `claude mcp remove tickler --scope user`, then step 1.
- **Entries show "unknown origin":** the hook isn't running. Check the path in `settings.json` and that `node --version` works in a terminal.
