# In-app guide format

The Markdown files in `docs/guides/` are used in two places from one source:

1. **The docs site**, as normal pages under `/guides/`.
2. **The iPhone and Android apps**, bundled at build time so they work offline. `tickler-app/scripts/sync-shared.sh` copies `docs/guides/` to `shared/guides/` and `docs/providers/` to `shared/guides/providers/`.

## Files

| File | Shown in the app at |
| --- | --- |
| `deploy-cloudflare.md` | Onboarding, step 1, Cloudflare |
| `deploy-docker.md` | Onboarding, step 1, Docker |
| `existing-server.md` | Onboarding, step 1, I already have a server |
| `public-url-cloudflare-tunnel.md`, `public-url-tailscale-funnel.md` | Linked from the Docker guide and "Needs a public URL" |
| `pair.md` | Onboarding, step 2 |
| `connect/claude-code.md`, `connect/claude-apps.md`, `connect/cursor.md`, `connect/codex.md`, `connect/chatgpt.md`, `connect/gemini-cli.md`, `connect/t3-code.md`, `connect/other.md` | Onboarding, step 3, and Settings, AI tools |
| `instruction-block.md` | Onboarding, step 3, "Copy instruction block" |
| `money.md` | Onboarding, step 4, and the Money tab |
| `providers/*.md` (from `docs/providers/`) | Money, a provider, Guide |
| `notifications.md` | Onboarding, step 5, before asking for permission |
| `images/*.png` | Screenshots referenced by the guides and the provider guides |

## Rules for these files

So they render the same in a simple Markdown renderer:

- **Plain CommonMark plus GitHub tables.** Headings, paragraphs, lists, bold, inline code, fenced code blocks, links, images, tables.
- **No front matter, no `:::` containers, no Vue components, no HTML.**
- **Links:** relative links to other guides with the `.md` extension (`pair.md`, `../instruction-block.md`, `providers/stripe.md`). Apps open these in the guide viewer. Absolute `https://` links open in the browser. Don't link to site-only pages; keep guides self-contained.
- **Images:** relative paths into `docs/guides/images/`, PNG, with alt text. About 1200 px wide, cropped to what matters, and compressed. From `docs/guides/` that's `images/x.png`, from `connect/` it's `../images/x.png`, and from `docs/providers/` it's `../guides/images/x.png`. The iPhone app also falls back to `images/<file name>`.
- **No long dashes.** Plain, friendly English.
- **The first `#` heading is the guide's title** in the app.

## Steps

The apps show every guide as a walkthrough: one step per screen, with **Complete**, **Skip** and **Restart**. So every guide follows this shape:

- **`# Title`, then one intro sentence** (at most 25 words) saying what you get at the end and roughly how long it takes.
- **Every `##` heading is one step**, shown alone on its own screen. Use a short imperative heading with no "Step 1:" prefix; the app numbers the steps. For example `## Open setup on a computer`.
- **A step body is at most about 50 words:** one sentence, or 2 to 4 numbered actions. At most one fenced code block, and one image.
- **One optional reference section, `## Troubleshooting`, comes last.** The app doesn't count it as a step and shows it behind a "Having trouble?" button. Write fixes as short bullets: "**Code expired:** make a new one." Background, advanced options and anything else that isn't a step goes into a step, into Troubleshooting, or out.
- **Aim for 3 to 6 steps.** Cut explanations people don't need to act. Keep every placeholder, every exact command or config snippet, and every useful relative `.md` link.
- **No `###` headings** inside steps.

## Screenshots

- **Every step should have an image** named `<guide-slug>-<step number>.png`, like `pair-2.png`. A guide may reuse another guide's image when the step is the same.
- **Real screenshots only.** Never a mock-up of someone else's interface, and never a placeholder.
- **What we capture ourselves:** the server's own pages (`/setup`, pairing, AI tools, Money, the OAuth approval page), terminal output for CLI steps, and the app. The app shots are `app-welcome.png`, `app-hosting.png`, `app-pair.png`, `app-connect.png`, `app-money.png`, `app-provider.png`, `app-notifications.png` and `app-now.png`.
- **Steps in a logged-in dashboard** (Cloudflare, Stripe, App Store Connect, Google Cloud and so on) have no image until someone captures one from a real account. Leave the image out rather than inventing one.

## Placeholders

The apps replace these before rendering, with the current server's values:

| Placeholder | Replaced with | Example |
| --- | --- | --- |
| `{{SERVER_URL}}` | The server's base URL, no trailing slash | `https://tickler.ann.workers.dev` |
| `{{MCP_TOKEN}}` | A fresh MCP token created for that client (`POST /api/tokens`), or the text `tkm_your_token_here` if the app hasn't made one yet | `tkm_...` |

On the website, the build swaps them for `https://your-server.example.com` and `tkm_your_token_here` (see `PLACEHOLDERS` in `docs/.vitepress/config.ts`), and pages under `/guides/` show a short note saying so.

Code blocks in the apps should have a **Copy** button that copies the substituted text.

## Notes for the apps

- `GET /api/connect` returns the per-client snippets with the URL filled in and a `docs` field naming the matching guide, for example `connect/cursor`.
- `ProviderStatus.guide` is a path like `providers/stripe`; open `providers/stripe.md` from the bundled guides.
