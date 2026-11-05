# Origins explained

Every entry in Tickler remembers **where it came from**: the chat, coding session, thread or scheduled run that created it. That's its **origin**. When you see "Check the deploy logs, Thursday 10:00" on your phone, the origin tells you which conversation decided that, and gets you back there in one tap.

## What an origin contains

| Field | Example | Used for |
| --- | --- | --- |
| Client | Claude Code, Cursor, ChatGPT | The small icon on every row |
| Title | "Fix flaky checkout test" | What the conversation was about |
| Open link | `https://claude.ai/code/...` | **Open chat** |
| Resume command | `cd ~/code/shop && claude --resume 4f1c...` | **Copy resume command** |
| Machine, folder, repo, branch | `macbook`, `~/code/shop`, `github.com/you/shop`, `fix/checkout` | Context on the origin card |
| Parent | The session that started this subagent or scheduled run | **Show parent** |

Not every tool can fill in every field. Tickler shows what it has.

## The origin card

At the top of every entry:

- **Open chat** opens the conversation, in the Claude or ChatGPT app if installed, or in the browser.
- **Copy resume command** copies a terminal command. Send it to your Mac with the share sheet and paste it in a terminal to continue right where the agent left off.
- **Show parent** follows a chain: a scheduled run, back to the session that scheduled it.
- **Last changed by** shows the origin of the most recent change, if it's different from the creator.

## Agents and chats

In **Projects**, the **Agents & Chats** view lists every origin, newest first, with its entries on a small timeline. It's a quick way to see what one long session promised to do.

## How origins get filled in, per tool

The rule: wherever possible the origin is filled in **outside the model**, by the tool itself or a hook, so it's always right. The model only fills it in when there's no other way.

| Tool | How | Quality |
| --- | --- | --- |
| Claude Code (terminal, desktop, IDE, web) | The [origin hook](/guides/connect/claude-code#step-3-install-the-origin-hook-recommended) adds session id, folder, repo, branch and resume command to every call | Exact |
| T3 Code | The agent passes the thread id; link opens the T3 thread | Good |
| Codex, Cursor, Gemini CLI | The [instruction block](/guides/instruction-block) asks the model to pass what it knows | Usually good |
| Claude apps, ChatGPT | These apps don't tell connectors which chat is calling. Tickler stores the client and the chat's topic, and the app offers **Open Claude** or **Open ChatGPT** with the title copied for search | Title only |
| Scheduled runs | Pass the task id and the parent session id | Good |

## Unknown origin

If an agent writes without any origin, Tickler still saves the entry, files it under **Other**, and shows a small flag so you notice. Usually it means the hook or instruction block isn't set up for that tool yet.

## Privacy

Origins are stored on your server like everything else. The resume command and folder paths can reveal folder names on your computer, so they're only visible to devices you paired. You can see every write, with its origin, under **Settings**, then **Activity log**.
