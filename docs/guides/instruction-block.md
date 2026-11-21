# The instruction block

Paste this short text into your AI tool's instructions once, and your agent adds Tickler entries and keeps them up to date as the work gets done. About 1 minute.

## Copy the block

Copy this text. It has no address or token, so it's safe to share and commit.

```
You have the `tickler` MCP server. Whenever you schedule something, defer something ("later", "tomorrow", "after review"), set up a scheduled task or routine, hand the user something to do on a date, or note a deadline, launch or renewal, also call `tickler.create_entry` with the project name, a short title, the time in UTC, a link to the source (commit, PR, doc) and `origin` (your client, your session or thread id, and a link to this chat if you have one; keep values a hook has filled in). Use a stable `external_key` so re-runs update instead of duplicating. Mark it `important` if missing it costs money, users or a launch window. When you do, change or drop something an entry mentions, update that entry in the same turn without being asked: find it with `list_entries` (search the title or `external_key`), rewrite its title and notes so they say what's done and what's left, add the commit or PR link, then call `complete_entry` if it's finished, set `in_progress` if only part is done, `cancelled` if it no longer applies, or move its date if the plan changed. Check for other entries the same work settles too. If a duplicate is likely, call `list_entries` first.
```

![The instruction block with its Copy button](images/instruction-block-1.png)

## Paste it into your tool

Add it at the end of the file or setting below. Create the file if it doesn't exist. One global place is enough.

| Tool | File or setting | Applies to |
| --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | every project on this computer |
| Claude Code | `CLAUDE.md` in a project folder | that project only |
| Codex | `~/.codex/AGENTS.md` | every project |
| Codex, and other tools that read it | `AGENTS.md` in a project folder | that project only |
| Cursor | Settings, then **Rules**, then **User Rules** | every project |
| Cursor | `.cursor/rules/tickler.mdc` in a project | that project only |
| Gemini CLI | `~/.gemini/GEMINI.md` | every project |
| Claude apps | a Project's instructions, or Settings, then **Profile**, then personal preferences | those chats |
| ChatGPT | a Project's instructions, or **Customize ChatGPT** | those chats |

## Check it works

Ask your agent to do something later, like "remind me to check the build tomorrow at 10:00". It should add a Tickler entry without being told to.

![Entries on the Now screen](images/app-now.png)

## Troubleshooting

- **Make it yours:** add lines like "Always use the project name `Work` for anything in this folder" to a project's file.
- **Teammates without Tickler:** their agent doesn't have the tool, so it ignores the instruction.
