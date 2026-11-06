# Sources checked

Official documentation each part of Tickler relies on, with the date it was last checked. Each area adds its own section; don't rewrite other sections.

## Docs, guides and launch kit

All checked 2026-11-06 unless noted. "Verify" means we couldn't confirm it from an official page and the owner should check before relying on it.

### Hosting and networking

| Topic | Source | Checked |
| --- | --- | --- |
| Deploy to Cloudflare button | https://developers.cloudflare.com/workers/platform/deploy-buttons/ | 2026-11-06 |
| Workers limits (free plan) | https://developers.cloudflare.com/workers/platform/limits/ | 2026-11-06 |
| Workers pricing | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-06 |
| D1 pricing and limits | https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/d1/platform/limits/ | 2026-11-06 |
| workers.dev routing | https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ | 2026-11-06 |
| Pages and VitePress | https://developers.cloudflare.com/pages/framework-guides/deploy-a-vitepress-site/ and https://developers.cloudflare.com/pages/configuration/build-configuration/ | 2026-11-06 (subfolder settings inferred, verify on first deploy) |
| Pages custom domains | https://developers.cloudflare.com/pages/configuration/custom-domains/ | 2026-11-06 |
| Quick tunnels | https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/ | 2026-11-06 |
| Cloudflare Tunnel setup | https://developers.cloudflare.com/tunnel/setup/ and https://developers.cloudflare.com/tunnel/guides/update-cloudflared/ | 2026-11-06 |
| Tailscale Funnel | https://tailscale.com/kb/1223/funnel and https://tailscale.com/kb/1311/tailscale-funnel | 2026-11-06 |
| Tailscale in Docker | https://tailscale.com/docs/features/containers/docker/docker-params | 2026-11-06 |

### AI tool connections

| Topic | Source | Checked |
| --- | --- | --- |
| Claude Code MCP | https://code.claude.com/docs/en/mcp | 2026-11-06 |
| Claude Code hooks (PreToolUse, `updatedInput`) | https://code.claude.com/docs/en/hooks | 2026-11-06 |
| Claude Code on the web | https://code.claude.com/docs/en/claude-code-on-the-web | 2026-11-06 (no session URL variable documented) |
| Claude custom connectors | https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp | 2026-11-06 (mobile sync: verify) |
| Cursor MCP | https://cursor.com/docs/context/mcp | 2026-11-06 |
| Codex MCP | https://learn.chatgpt.com/docs/extend/mcp?surface=cli | 2026-11-06 |
| Gemini CLI MCP | https://geminicli.com/docs/tools/mcp-server/ | 2026-11-06 |
| ChatGPT custom MCP / developer mode | https://developers.openai.com/apps-sdk/deploy/connect-chatgpt and https://help.openai.com/en/articles/12584461 | 2026-11-06 (help page blocked; plan availability: verify) |
| T3 Code MCP behaviour | https://github.com/pingdotgg/t3code/discussions/14118 | 2026-11-06 (community report, verify) |

### Directories and registries

| Topic | Source | Checked |
| --- | --- | --- |
| MCP Registry quickstart | https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx | 2026-11-06 |
| MCP Registry remote servers | https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx | 2026-11-06 |
| MCP Registry package types (OCI label) | https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx | 2026-11-06 |
| server.json schema | https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json | 2026-11-06 |
| awesome-mcp-servers | https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md | 2026-11-06 |
| awesome-selfhosted | https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md | 2026-11-06 |
| Cloudflare Built with Workers | https://blog.cloudflare.com/meet-the-workers-team-over-discord | 2026-11-06 (old showcase page is gone; verify current channel) |

### App stores

| Topic | Source | Checked |
| --- | --- | --- |
| App Review Guidelines 2.1, 2.3.7, 2.3.10, 4.1, 4.2, 5.1.1(v), 5.2 | https://developer.apple.com/app-store/review/guidelines/ | 2026-11-06 |
| App information limits | https://developer.apple.com/help/app-store-connect/reference/app-information/app-information | 2026-11-06 |
| Version text limits (keywords 100 bytes) | https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information | 2026-11-06 |
| Screenshot sizes | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications | 2026-11-06 |
| App privacy details | https://developer.apple.com/app-store/app-privacy-details/ | 2026-11-06 |
| Age ratings | https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions | 2026-11-06 |
| TestFlight | https://developer.apple.com/testflight/ and https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview | 2026-11-06 |
| Play listing limits | https://support.google.com/googleplay/android-developer/answer/9859152 | 2026-11-06 |
| Play graphics | https://support.google.com/googleplay/android-developer/answer/9866151 | 2026-11-06 |
| Play metadata policy | https://support.google.com/googleplay/android-developer/answer/9898842 | 2026-11-06 |
| Play Data safety | https://support.google.com/googleplay/android-developer/answer/10787469 | 2026-11-06 |
| Play content rating | https://support.google.com/googleplay/android-developer/answer/9898843 | 2026-11-06 |
| Play app access | https://support.google.com/googleplay/android-developer/answer/15748846 | 2026-11-06 |
| Play testing requirement for new personal accounts | https://support.google.com/googleplay/android-developer/answer/14151465 | 2026-11-06 |

### Brands

| Topic | Source | Checked |
| --- | --- | --- |
| Anthropic trademark guidelines | https://www.anthropic.com/legal/trademark-guidelines | 2026-11-06 (doesn't cover "works with Claude"; verify with marketing@anthropic.com) |
| OpenAI brand guidelines | https://openai.com/brand/ | 2026-11-06 (page blocked; verify) |

### Launch channels

| Topic | Source | Checked |
| --- | --- | --- |
| Product Hunt launch guide | https://www.producthunt.com/launch/preparing-for-launch and https://www.producthunt.com/launch/launch-day-questions | 2026-11-06 (partly; verify) |
| Show HN rules | https://news.ycombinator.com/showhn.html | 2026-11-06 |
| HN guidelines (no generated text) | https://news.ycombinator.com/newsguidelines.html | 2026-11-06 |
| r/selfhosted rules | https://www.reddit.com/r/selfhosted/about/rules/ | Not fetchable (Reddit blocks tools); verify by hand |
| r/ClaudeAI rules | https://www.reddit.com/r/ClaudeAI/about/rules/ | Verify by hand |
| r/ClaudeCode rules | https://www.reddit.com/r/ClaudeCode/about/rules/ | Exists (unofficial, about 14k members per gummysearch.com); verify by hand |
| r/iOSapps rules | https://www.reddit.com/r/iOSapps/about/rules/ | Verify by hand |
| r/androidapps rules | https://www.reddit.com/r/androidapps/about/rules/ | Verify by hand |

## Server core


| Topic | URL | Checked | Used for |
| --- | --- | --- | --- |
| MCP authorization (draft) | https://modelcontextprotocol.io/specification/draft/basic/authorization | 2026-11-06 | Protected resource metadata, `WWW-Authenticate` with `resource_metadata` and `scope`, PKCE S256, `resource` (RFC 8707), `iss` (RFC 9207), client ID metadata documents, DCR |
| MCP TypeScript SDK 1.32 | `node_modules/@modelcontextprotocol/sdk` (`WebStandardStreamableHTTPServerTransport`) | 2026-11-06 | Stateless streamable HTTP on Workers and Node |
| Claude Code hooks | https://code.claude.com/docs/en/hooks | 2026-11-06 | PreToolUse input fields, `hookSpecificOutput.updatedInput` (replaces the whole input), matcher `mcp__tickler__.*`, `CLAUDE_CODE_REMOTE` |
| Deploy to Cloudflare button | https://developers.cloudflare.com/workers/platform/deploy-buttons/ | 2026-11-06 | Button URL, secrets from `.dev.vars.example`, `cloudflare.bindings` descriptions, deploy script |
| Wrangler configuration | https://developers.cloudflare.com/workers/wrangler/configuration/ | 2026-11-06 | D1 automatic provisioning (no `database_id`), `triggers.crons`, `rules` Text import for `.sql` |
| Workers Web Crypto | https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ | 2026-11-06 | PBKDF2 capped at 100,000 iterations on Workers |
| Workers Vitest integration | `node_modules/@cloudflare/vitest-pool-workers` 0.23 README | 2026-11-06 | `cloudflareTest` plugin (package is deprecated in favour of `@cloudflare/vitest-plugin`) |
| SimpleWebAuthn server v14 | https://simplewebauthn.dev/docs/packages/server | 2026-11-06 | Passkey registration and login (runs on Workers) |
| Codex MCP config | https://learn.chatgpt.com/docs/extend/mcp?surface=cli | 2026-11-06 | `[mcp_servers.x] url`, `bearer_token_env_var` |
| Gemini CLI MCP | https://geminicli.com/docs/tools/mcp-server/ | 2026-11-06 | `httpUrl` + `headers`, `gemini mcp add --transport http` (page notes Gemini CLI was succeeded by Antigravity CLI) |
| wrangler d1 migrations | `node_modules/wrangler` (`getCreateMigrationsTableQuery`) | 2026-11-06 | Same `d1_migrations` table in the Node runner |
