# r/ClaudeAI

## Rules (summary, verify before posting)

Rules page: https://www.reddit.com/r/ClaudeAI/about/rules/ (Reddit blocks automated fetching; read it by hand on posting day.)

What we could gather on 2026-11-06 (secondary sources, e.g. https://gummysearch.com/r/ClaudeAI):

- Large community (over a million members). Projects are usually posted with a **"Built with Claude"** style flair; use whatever flair the sub provides for showcases.
- New or low-karma accounts are reportedly filtered. Post from an account with some history in the sub.
- Promotional posts are expected to be useful on their own (explain how it works, not just a link).

Our rules for every Reddit post:

- Say clearly you're the developer.
- Don't ask for upvotes. Don't use alt accounts or ask friends to comment.
- Answer questions in the thread.
- Mention the paid tier honestly.
- Rewrite the draft in your own voice; many subs dislike obviously generated posts.

## Draft

**Title:** I built a calendar that Claude Code writes to, so "I'll check this tomorrow" actually happens

**Flair:** Built with Claude (or the sub's showcase flair)

```
I'm the developer of Tickler, so take this as a dev post.

Problem: Claude Code (and Claude in the apps) constantly defers things: "let's re-run this after the migration", "remind me to check the review on Friday". The session ends and that promise is gone.

Tickler is a small MCP server you host yourself (one-click on Cloudflare's free plan, or Docker) plus an iPhone/Android app. With a short block in CLAUDE.md, Claude adds an entry whenever it defers something.

The part I like most: a PreToolUse hook fills in the origin outside the model (session id, repo, branch, cwd), so every entry on my phone has a "Copy resume command" that gives me `cd ... && claude --resume <id>`. For the Claude apps it works as a custom connector over OAuth (your own server is the OAuth server).

- Your data stays on your server; there's no account and nothing comes to me
- Re-runs don't duplicate (stable external_key upserts)
- Optional Money tab (paid): app store sales, Anthropic/Cloudflare/AWS costs, budgets, forecasts

Server is AGPL on GitHub: [link]. Apps: [links]. There's a demo mode if you want to look first.

What would you want agents to put on a calendar that I haven't thought of?
```

## Beta seeding version

Before launch, a shorter post asking for TestFlight and Play testers, if the rules allow beta recruitment. Same disclosure. Link to the GitHub Discussions beta category for feedback.
