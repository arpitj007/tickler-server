// "Connect this computer": one command the app shows, `curl -fsSL <server>/c/<code> | sh`.
// The script finds Claude Code, Codex, Cursor and Gemini CLI, redeems the one-time code for a token per
// tool, writes each tool's config, the Claude Code origin hook and the instruction block, then makes one
// MCP call per tool so the app sees them connect. Config formats: see connect.ts.
import { INSTRUCTION_BLOCK } from "./connect";
import type { Actor, Ctx } from "./context";
import { createToken } from "./devices";
import { logActivity } from "./activity";
import { ApiError, PAIRING_ALPHABET, pairingCode } from "./util";

export const CONNECT_TTL_MS = 15 * 60_000;
export const CLI_CLIENTS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  "gemini-cli": "Gemini CLI",
};
const HOOK_URL = "https://raw.githubusercontent.com/arpitj007/tickler-server/main/hooks/claude-code/tickler-origin.mjs";
const CODE_RE = new RegExp(`^[${PAIRING_ALPHABET}]{8}$`);

export const isConnectCode = (code: string) => CODE_RE.test(code);
export const connectCommand = (base: string, code: string) => `curl -fsSL ${base}/c/${code} | sh`;

export async function createConnectCode(ctx: Ctx, actor: Actor) {
  const now = ctx.now();
  const code = pairingCode();
  const expires = new Date(now.getTime() + CONNECT_TTL_MS).toISOString();
  await ctx.storage.run("DELETE FROM connect_codes WHERE expires_at < ?", [now.toISOString()]);
  await ctx.storage.run("INSERT INTO connect_codes (code, created_at, expires_at) VALUES (?, ?, ?)", [code, now.toISOString(), expires]);
  await logActivity(ctx, actor, "create_connect_code", "Connect command created");
  return { code, expires_at: expires };
}

async function liveCode(ctx: Ctx, code: string) {
  const row = await ctx.storage.first<{ expires_at: string; used_at: string | null }>("SELECT * FROM connect_codes WHERE code = ?", [code]);
  return !!row && !row.used_at && Date.parse(row.expires_at) > ctx.now().getTime();
}

/** Single use: one token per tool found, named after the computer so each can be revoked on its own. */
export async function redeemConnectCode(ctx: Ctx, code: string, clients: string[], computer: string) {
  if (!(await liveCode(ctx, code))) throw new ApiError(400, "pairing_expired", "This command expired or was already used. Get a new one in the Tickler app.");
  const claim = await ctx.storage.run("UPDATE connect_codes SET used_at = ? WHERE code = ? AND used_at IS NULL", [ctx.now().toISOString(), code]);
  if (claim.changes !== 1) throw new ApiError(400, "pairing_expired", "This command was already used.");
  const where = computer.replace(/[^\p{L}\p{N} ._'-]/gu, "").trim().slice(0, 40) || "a computer";
  const out: [string, string][] = [];
  for (const id of new Set(clients)) {
    const name = CLI_CLIENTS[id];
    if (!name) continue;
    const tokenName = `${name} on ${where}`;
    // Running the command again on the same computer replaces that tool's config, so retire its old token.
    await ctx.storage.run("DELETE FROM mcp_tokens WHERE name = ?", [tokenName]);
    const { secret } = await createToken(ctx, tokenName, { type: "admin", id: "connect", name: "Connect command" });
    out.push([id, secret]);
  }
  return out;
}

/** The script itself. It holds no secret: tokens come from the POST, which uses up the code. */
export async function connectScript(ctx: Ctx, base: string, code: string): Promise<string | null> {
  if (!/^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\-/]*)?$/.test(base) || !(await liveCode(ctx, code))) return null;
  const values: Record<string, string> = { SERVER: base.replace(/\/+$/, ""), CODE: code, INSTRUCTIONS: INSTRUCTION_BLOCK, HOOK_URL };
  return SCRIPT.replace(/__(SERVER|CODE|INSTRUCTIONS|HOOK_URL)__/g, (_, k: string) => values[k]!);
}

export const EXPIRED_SCRIPT = `#!/bin/sh
echo "This Tickler command expired or was already used. Open the Tickler app, then AI tools, for a new one." >&2
exit 1
`;

const SCRIPT = String.raw`#!/bin/sh
# Tickler: connect the AI tools on this computer to __SERVER__
# Made by your own Tickler server. It only touches the Tickler parts of each tool's config.
SERVER="__SERVER__"
MCP="$SERVER/mcp"
say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

INSTRUCTIONS=$(cat <<'TICKLER_EOF'
__INSTRUCTIONS__
TICKLER_EOF
)

# Adds (or refreshes) the instruction block between markers, so running this twice changes nothing.
add_instructions() {
  f="$1"
  mkdir -p "$(dirname "$f")" && touch "$f" || return 1
  if grep -q '<!-- tickler -->' "$f"; then
    awk '/<!-- tickler -->/ { skip = 1 } !skip { print } /<!-- \/tickler -->/ { skip = 0 }' "$f" > "$f.tickler" && mv "$f.tickler" "$f"
  fi
  { [ -s "$f" ] && printf '\n'; printf '<!-- tickler -->\n%s\n<!-- /tickler -->\n' "$INSTRUCTIONS"; } >> "$f"
}

# One MCP call, so the Tickler app shows the tool as connected.
check() {
  curl -fsS -o /dev/null -X POST "$MCP" -H "Authorization: Bearer $1" -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" -A "$2" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
}

claude_code() {
  claude mcp remove --scope user tickler >/dev/null 2>&1
  claude mcp add --transport http --scope user tickler "$MCP" --header "Authorization: Bearer $1" >/dev/null || return 1
  add_instructions "$HOME/.claude/CLAUDE.md"
  if have node; then
    mkdir -p "$HOME/.claude/hooks" && curl -fsSL "__HOOK_URL__" -o "$HOME/.claude/hooks/tickler-origin.mjs" && node -e '
const fs = require("fs"), p = process.argv[1];
let s = {};
if (fs.existsSync(p)) { try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch { console.error("  Left " + p + " alone (not plain JSON); add the hook by hand."); process.exit(0); } }
const pre = ((s.hooks ??= {}).PreToolUse ??= []);
if (!pre.some((h) => h.matcher === "mcp__tickler__.*"))
  pre.push({ matcher: "mcp__tickler__.*", hooks: [{ type: "command", command: "node ~/.claude/hooks/tickler-origin.mjs" }] });
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");' "$HOME/.claude/settings.json" || say "  (Claude Code works; the origin hook didn't install. See the Claude Code guide.)"
  fi
  return 0
}

codex_cli() {
  f="$HOME/.codex/config.toml"
  mkdir -p "$HOME/.codex" && touch "$f" || return 1
  awk '/^\[/ { skip = (index($0, "[mcp_servers.tickler]") == 1 || index($0, "[mcp_servers.tickler.") == 1) } !skip { print }' "$f" > "$f.tickler" && mv "$f.tickler" "$f"
  printf '\n[mcp_servers.tickler]\nurl = "%s"\nhttp_headers = { "Authorization" = "Bearer %s" }\n' "$MCP" "$1" >> "$f"
  add_instructions "$HOME/.codex/AGENTS.md"
}

cursor_app() {
  f="$HOME/.cursor/mcp.json"
  mkdir -p "$HOME/.cursor" || return 1
  if have node; then
    node -e '
const fs = require("fs"), [p, url, token] = process.argv.slice(1);
let s = {};
if (fs.existsSync(p) && fs.readFileSync(p, "utf8").trim()) s = JSON.parse(fs.readFileSync(p, "utf8"));
(s.mcpServers ??= {}).tickler = { url, headers: { Authorization: "Bearer " + token } };
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");' "$f" "$MCP" "$1"
  elif [ ! -s "$f" ]; then
    printf '{\n  "mcpServers": {\n    "tickler": { "url": "%s", "headers": { "Authorization": "Bearer %s" } }\n  }\n}\n' "$MCP" "$1" > "$f"
  else
    say "  $f already exists and Node.js isn't installed to edit it. Use the Cursor guide in the Tickler app."
    return 1
  fi
}

gemini_cli() {
  gemini mcp remove --scope user tickler >/dev/null 2>&1
  gemini mcp add --transport http --scope user --header "Authorization: Bearer $1" tickler "$MCP" >/dev/null || return 1
  add_instructions "$HOME/.gemini/GEMINI.md"
}

# Everything runs from main, so a half-downloaded script does nothing.
main() {
  found=""
  have claude && found="$found,claude-code"
  { have codex || [ -d "$HOME/.codex" ]; } && found="$found,codex"
  { have cursor || [ -d "$HOME/.cursor" ] || [ -d /Applications/Cursor.app ]; } && found="$found,cursor"
  have gemini && found="$found,gemini-cli"
  found=$(printf '%s' "$found" | sed 's/^,//')
  if [ -z "$found" ]; then
    say "No Claude Code, Codex, Cursor or Gemini CLI found on this computer."
    say "Install one and run this again, or follow the guide for your tool in the Tickler app."
    exit 1
  fi

  computer=$(/usr/sbin/scutil --get ComputerName 2>/dev/null || hostname 2>/dev/null || echo computer)
  tokens=$(curl -fsS -X POST "$SERVER/c/__CODE__" --data-urlencode "clients=$found" --data-urlencode "computer=$computer" </dev/null) || {
    say "This command expired or was already used. Open the Tickler app, then AI tools, for a new one."
    exit 1
  }

  say ""
  failed=0
  while IFS=: read -r id name fn; do
    token=$(printf '%s\n' "$tokens" | awk -v id="$id" '$1 == id { print $2 }')
    [ -n "$token" ] || continue
    if $fn "$token" </dev/null && check "$token" "$id" </dev/null; then say "  ✓ $name"; else say "  ✗ $name: see its guide in the Tickler app"; failed=1; fi
  done <<'TOOLS'
claude-code:Claude Code:claude_code
codex:Codex:codex_cli
cursor:Cursor:cursor_app
gemini-cli:Gemini CLI:gemini_cli
TOOLS
  say ""
  [ "$failed" = 0 ] && say "Done. Restart open sessions, then ask: \"remind me tomorrow at 10 to check this\"."
  say "Revoke a tool any time in the Tickler app, under AI tools."
}

main
`;
