# tickler

Command line for [Tickler](https://github.com/arpitj007/tickler-server), the calendar for things AI
agents plan for later.

## `tickler bridge`

Runs prompts you send from the Tickler app ("Build with AI", "Send to chat") in your agents' own
sessions on this computer: T3 Code, Claude Code and Codex, plus Gemini CLI if you opt in.

```sh
npx tickler bridge install --server https://your-tickler-server --code K7Q2M9PX
```

Get the command with its one-time code in the app, under **Run with AI**. It pairs this computer and
keeps the bridge running in the background (launchd on macOS, a systemd user service on Linux).

- **It only runs messages.** The server sends a message and which session or folder it's for. How
  each agent is started is built into the bridge, never sent by the server.
- **Messages go in on stdin.** Nothing lands in a shell command or in `ps`.
- **No permission skipping.** The bridge never adds flags like `--dangerously-skip-permissions` or
  `--yolo`. Your agent's own settings decide what it may do.
- **Only your folders.** It runs only in folders under `roots` (default: your home folder).
- **Only your phone.** Only a paired phone can queue prompts. Agents connected to Tickler can't.

### Commands

| Command | What it does |
| --- | --- |
| `tickler bridge install [--server <url> --code <code>]` | Pair and run in the background (`--no-service` to skip that) |
| `tickler bridge` | Run in the foreground |
| `tickler bridge status` | Show pairing, agents found and project folders |
| `tickler bridge map <project-id> [--cwd .] [--client t3_code]` | Start new sessions for a project in a folder |
| `tickler bridge unmap <project-id>` | Remove that |
| `tickler bridge uninstall` | Stop and remove the background service |

### Config

`~/.tickler/bridge.json` (readable only by you):

```json
{
  "roots": ["/Users/you"],
  "runners": { "codex": { "enabled": false }, "gemini_cli": { "enabled": true } },
  "projects": [{ "project_id": "…", "cwd": "/Users/you/dev/app", "client": "t3_code" }],
  "timeout_minutes": 60
}
```

Log: `~/.tickler/bridge.log`. To disconnect the computer, remove it in the app and run
`tickler bridge uninstall`.

License: AGPL-3.0-only.
