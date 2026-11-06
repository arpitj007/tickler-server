# Claude Code origin hook

Every entry Claude Code creates in Tickler links back to the session that created it: the repo,
branch, machine, a working `claude --resume` command, and the first prompt as its title. The
hook fills this in outside the model, so it is right even when the model doesn't know its own
session id.

It is a `PreToolUse` hook on `mcp__tickler__.*`. For the write tools (`create_entry`,
`update_entry`, `complete_entry`, `delete_entry`, `mark_important`) it returns the tool input
with `origin` filled in through `hookSpecificOutput.updatedInput`. Values the model already put
in `origin` are kept. Read tools are left alone. It needs only Node (which Claude Code already
has), no packages, and never blocks a call.

## Install

1. Copy the script:

   ```sh
   mkdir -p ~/.claude/hooks
   curl -fsSL https://raw.githubusercontent.com/arpitj007/tickler-server/main/hooks/claude-code/tickler-origin.mjs \
     -o ~/.claude/hooks/tickler-origin.mjs
   ```

2. Add the hook to `~/.claude/settings.json` (merge with what's there; see
   `settings.example.json`):

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "mcp__tickler__.*",
           "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/tickler-origin.mjs\"", "timeout": 10 }]
         }
       ]
     }
   }
   ```

   The matcher assumes you added the server as `tickler` (`claude mcp add --transport http tickler ...`).

3. Restart Claude Code and ask it to "remind me tomorrow at 9 to check the deploy". Open the
   entry in the app: the origin card shows the repo and branch and a resume command.

## What it sends

| Field | From |
| --- | --- |
| `client` | `claude_code`, or `claude_code_web` when `CLAUDE_CODE_REMOTE=true` |
| `session_id` | hook input `session_id` (subagents: `<session>/<agent_id>`, with `parent_session_id`) |
| `title` | first prompt in the transcript, 80 characters |
| `resume_command` | `cd <cwd> && claude --resume <session_id>` (local sessions) |
| `cwd`, `transcript_path` | hook input |
| `repo`, `branch` | `git remote get-url origin`, `git symbolic-ref --short HEAD` (or the commit when detached) |
| `machine` | hostname |
| `open_url` | `TICKLER_OPEN_URL` if set; on Claude Code on the web, `https://claude.ai/code/<id>` when `CLAUDE_CODE_REMOTE_SESSION_ID` is present |

Nothing is sent anywhere by the hook itself; it only edits the arguments of the Tickler call
that Claude Code was about to make to your own server.

## Options

- `TICKLER_HOOK_ALLOW=1` also returns `permissionDecision: "allow"`, so Tickler writes skip the
  permission prompt. Without it, the normal permission rules apply.

## Test

```sh
echo '{"session_id":"abc","cwd":"'"$PWD"'","tool_name":"mcp__tickler__create_entry","tool_input":{"project":"x","title":"y"}}' \
  | node hooks/claude-code/tickler-origin.mjs
```
