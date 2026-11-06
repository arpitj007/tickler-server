# Awesome lists

Both lists below discourage or ban machine-written contributions. **The owner should write and submit these entries personally**, using the notes here as a checklist only.

## punkpeye/awesome-mcp-servers

Rules (https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md, checked 2026-11-06):

- The server must have a public repo you can run yourself (remote-only servers go to a separate awesome-remote-mcp-servers list).
- One line per server, alphabetical within its category, short description.
- PRs made by an AI agent must add `🤖🤖🤖` to the end of the PR title. Writing it yourself avoids that.
- A Glama score badge appears on many entries but isn't required.

Legend used in entries: 📇 TypeScript, ☁️ cloud service, 🏠 runs locally, 🍎 🪟 🐧 operating systems.

Category: there is no "Calendar" category. Closest fit: **Workplace & Productivity** (check the current README; fallback "Other Tools and Integrations").

Entry line (draft, keep the list's exact format at submission time):

```
- [arpitj007/tickler-server](https://github.com/arpitj007/tickler-server) 📇 ☁️ 🏠 - Self-hosted calendar that agents write follow-ups, deadlines and scheduled runs to, each linked back to the chat or session that created it. Runs on Cloudflare Workers or Docker.
```

When: after 1.0 is tagged and the README has clear setup steps.

## awesome-selfhosted

Rules (https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md, checked 2026-11-06):

- The **first release must be more than 4 months old**, with tagged releases.
- Projects without development for 6 to 12 months may be removed.
- License must be an SPDX identifier (AGPL-3.0 is fine).
- Software that **depends on a specific cloud provider** is excluded. Tickler qualifies only because the **Docker + SQLite** path is fully self-hosted. The entry must describe that path, not Cloudflare.
- Submit a PR adding `software/tickler.yml` in `awesome-selfhosted-data`, following `.github/ISSUE_TEMPLATE/addition.md`; remove comments and unused optional fields.
- Descriptions are short and skip words like "open-source", "free" and "self-hosted".
- **"Machine/LLM-generated contributions are not allowed and will result in a ban."** Write it yourself.

**Do we qualify yet?** No. Earliest date: 4 months after the first tagged release (for example, first tag on 2026-12-01 means submit after 2027-04-01). Add a reminder entry in Tickler itself for that date.

Facts to have ready when writing the YAML yourself: name, website (docs site), source code URL, license `AGPL-3.0`, platform `Nodejs` and `Docker`, a suitable tag (likely "Calendar & Contacts" or "Task Management & To-do Lists"; check the current tag list), and a one-sentence description.
