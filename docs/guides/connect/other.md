# Any other MCP client

Tickler is a standard MCP server, so any tool that speaks MCP can use it. Here's everything you need.

## Connection details

| Setting | Value |
| --- | --- |
| URL | `{{SERVER_URL}}/mcp` |
| Transport | Streamable HTTP (sometimes just called "HTTP") |
| Auth, option 1 | Header `Authorization: Bearer {{MCP_TOKEN}}` |
| Auth, option 2 | OAuth 2.1 with PKCE and dynamic client registration, discovered automatically from the URL |

Make a token on your server's setup page under **AI tools**, then **New token**. Use one token per tool, so you can revoke them one at a time.

## A typical JSON config

Many clients use a file like this:

```json
{
  "mcpServers": {
    "tickler": {
      "type": "http",
      "url": "{{SERVER_URL}}/mcp",
      "headers": { "Authorization": "Bearer {{MCP_TOKEN}}" }
    }
  }
}
```

Some call the URL field `serverUrl` or `httpUrl`, or the type `streamable-http`. Check your client's docs.

## Clients that only run local (stdio) servers

Use the `mcp-remote` bridge, which runs locally and forwards to Tickler. It needs Node.js:

```json
{
  "mcpServers": {
    "tickler": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "{{SERVER_URL}}/mcp",
        "--header", "Authorization: Bearer {{MCP_TOKEN}}"
      ]
    }
  }
}
```

## Tell it when to use Tickler

Paste the [instruction block](../instruction-block.md) wherever your client keeps its system prompt or rules.

## Set the origin

Ask your agent (or your wrapper script) to send an `origin` object with each write, so entries link back to where they came from:

```json
{
  "client": "other",
  "session_id": "your-tool-session-id",
  "title": "Short description of the conversation",
  "open_url": "a link that reopens it, if there is one"
}
```

If nothing is sent, Tickler still saves the entry and marks its origin as unknown.

## Testing by hand

You can check the connection with `curl`. This should return a list of Tickler's tools:

```
curl -s {{SERVER_URL}}/mcp \
  -H "Authorization: Bearer {{MCP_TOKEN}}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
