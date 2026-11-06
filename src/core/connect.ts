// "Connect your AI tools" snippets with this server's URL filled in. Used by /setup and GET /api/connect.
// Client config formats checked 2026-11-06:
//   Claude Code  https://code.claude.com/docs/en/mcp
//   Codex        https://learn.chatgpt.com/docs/extend/mcp?surface=cli (url + bearer_token_env_var)
//   Gemini CLI   https://geminicli.com/docs/tools/mcp-server/ (httpUrl + headers)
//   Cursor       https://cursor.com/docs/context/mcp (mcp.json url + headers)

export const INSTRUCTION_BLOCK = `You have the \`tickler\` MCP server. Whenever you schedule something, defer something ("later", "tomorrow", "after review"), set up a scheduled task or routine, hand the user something to do on a date, or note a deadline, launch or renewal, also call \`tickler.create_entry\` with the project name, a short title, the time in UTC, a link to the source (commit, PR, doc) and \`origin\` (your client, your session or thread id, and a link to this chat if you have one; keep values a hook has filled in). Use a stable \`external_key\` so re-runs update instead of duplicating. Mark it \`important\` if missing it costs money, users or a launch window. When you finish something that has an entry, call \`complete_entry\`. If a duplicate is likely, call \`list_entries\` first.`;

export interface ConnectClient {
  id: string;
  name: string;
  auth: "token" | "oauth";
  snippet: string;
  docs: string;
  note?: string;
}

const DOCS = "https://github.com/arpitj007/tickler-server/blob/main/docs";

export function connectClients(baseUrl: string, token = "<TOKEN>"): ConnectClient[] {
  const mcp = `${baseUrl}/mcp`;
  return [
    {
      id: "claude_code",
      name: "Claude Code",
      auth: "token",
      snippet: `claude mcp add --transport http tickler ${mcp} --header "Authorization: Bearer ${token}" --scope user`,
      docs: `${DOCS}/guides/connect/claude-code.md`,
      note: "Also install the origin hook from hooks/claude-code so every entry links back to its session.",
    },
    {
      id: "claude_app",
      name: "Claude apps (custom connector)",
      auth: "oauth",
      snippet: `Settings > Connectors > Add custom connector\nName: Tickler\nURL: ${mcp}`,
      docs: `${DOCS}/guides/connect/claude-apps.md`,
      note: "Sign in with your Tickler admin passphrase or passkey when asked.",
    },
    {
      id: "cursor",
      name: "Cursor",
      auth: "token",
      snippet: JSON.stringify({ mcpServers: { tickler: { url: mcp, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
      docs: `${DOCS}/guides/connect/cursor.md`,
      note: "Put this in ~/.cursor/mcp.json (all projects) or .cursor/mcp.json (one project).",
    },
    {
      id: "codex",
      name: "Codex",
      auth: "token",
      snippet: `# ~/.codex/config.toml\n[mcp_servers.tickler]\nurl = "${mcp}"\nbearer_token_env_var = "TICKLER_TOKEN"\n\n# and in your shell profile:\nexport TICKLER_TOKEN="${token}"`,
      docs: `${DOCS}/guides/connect/codex.md`,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      auth: "oauth",
      snippet: `Settings > Apps & Connectors > Advanced > Developer mode, then Create connector\nURL: ${mcp}\nAuthentication: OAuth`,
      docs: `${DOCS}/guides/connect/chatgpt.md`,
      note: "Custom MCP connectors are only available on some ChatGPT plans.",
    },
    {
      id: "gemini_cli",
      name: "Gemini CLI",
      auth: "token",
      snippet: `gemini mcp add --transport http --scope user --header "Authorization: Bearer ${token}" tickler ${mcp}`,
      docs: `${DOCS}/guides/connect/gemini-cli.md`,
      note: `Or in ~/.gemini/settings.json: "mcpServers": { "tickler": { "httpUrl": "${mcp}", "headers": { "Authorization": "Bearer ${token}" } } }`,
    },
    {
      id: "generic",
      name: "Any MCP client",
      auth: "token",
      snippet: `URL: ${mcp}\nTransport: Streamable HTTP\nHeader: Authorization: Bearer ${token}\nOAuth 2.1 metadata: ${baseUrl}/.well-known/oauth-authorization-server`,
      docs: `${DOCS}/guides/connect/other.md`,
    },
  ];
}
