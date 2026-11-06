# Sources checked for the server core

Official docs read before using each API, with the date checked.

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
