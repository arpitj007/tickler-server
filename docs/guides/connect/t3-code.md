# T3 Code and other orchestrators

Tools like T3 Code run other agents for you (Claude Code, Codex and others) in threads. Tickler works with them in two parts: connect the agents underneath, and pass the thread id so entries link back to the right thread.

## Step 1: Connect the agents it runs

T3 Code uses each agent's own MCP settings. So connect Tickler to each agent you run through it:

- [Claude Code](claude-code.md)
- [Codex](codex.md)
- [Cursor](cursor.md)

Then restart the orchestrator so it picks up the change.

## Step 2: Link entries to threads

Add this line under the [instruction block](../instruction-block.md) in the agent's instructions file:

```
When you run inside T3 Code, set origin.client to "t3_code", origin.session_id to the T3 thread id and origin.open_url to "t3-thread://v1/" followed by the thread id.
```

With that, the **Open chat** button on an entry's origin card opens the T3 thread on your computer.

## Scheduled runs

If your orchestrator runs scheduled tasks (routines, cron jobs), set `origin.client` to `scheduled_task`, `origin.session_id` to the task id and `origin.parent_session_id` to the thread or session that set it up. Then the app can show the chain: the run, and the chat that scheduled it.

## Subagents

When an agent starts a subagent, the subagent should pass its parent's session id as `origin.parent_session_id`. The origin card then has **Show parent**.
