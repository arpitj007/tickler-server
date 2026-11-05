# The instruction block

Connecting Tickler gives your AI tools the ability to add entries. This short block of text tells them **when** to do it. Paste it once into your tool's instructions file and every session follows it.

## The text

```
You have the `tickler` MCP server. Whenever you schedule something, defer something ("later", "tomorrow", "after review"), set up a scheduled task or routine, hand the user something to do on a date, or note a deadline, launch or renewal, also call `tickler.create_entry` with the project name, a short title, the time in UTC, a link to the source (commit, PR, doc) and `origin` (your client, your session or thread id, and a link to this chat if you have one; keep values a hook has filled in). Use a stable `external_key` so re-runs update instead of duplicating. Mark it `important` if missing it costs money, users or a launch window. When you finish something that has an entry, call `complete_entry`. If a duplicate is likely, call `list_entries` first.
```

## Where to paste it

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

If the file doesn't exist yet, create it. If it already has content, add the block at the end.

## Tips

- **One place is enough.** If you use Claude Code everywhere, the global `~/.claude/CLAUDE.md` covers all projects.
- **Edit it to taste.** For example, add "Always use the project name `Work` for anything in this folder" to a project's file.
- **It's safe to share.** The block contains no address or token, so you can commit it to a shared repo. Teammates without Tickler simply don't have the tool, and their agent ignores the instruction.
