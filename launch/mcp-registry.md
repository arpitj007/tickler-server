# Official MCP Registry

Registry: https://registry.modelcontextprotocol.io. Docs checked 2026-11-06:

- Quickstart: https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx
- Remote servers: https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx
- Package types (OCI): https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx
- Schema: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json

## Rules that matter for us

- **Namespace:** logging in with GitHub as `arpitj007` allows names starting with `io.github.arpitj007/`. We use `io.github.arpitj007/tickler`. (With DNS verification of gettickler.com, `com.gettickler/tickler` becomes possible later.)
- **OCI packages:** the Docker image must carry the label `io.modelcontextprotocol.server.name` with exactly the server name. `ghcr.io` is allowed. **Server to-do (Dockerfile is owned by the server work):**

```dockerfile
LABEL io.modelcontextprotocol.server.name="io.github.arpitj007/tickler"
```

- **Remotes:** a remote URL "must be publicly accessible", and each URL can belong to only one server name. Tickler is self-hosted, so there is no single URL. The schema supports URL **variables** (`{host}`), which fits a per-user server. **Verify** that the publisher accepts a fully templated host; if it doesn't, publish only the OCI package.
- Re-publish on every release with a bumped `version`.

## server.json draft

Save as `server.json` in the repo root at release time (the version must match the release and image tag):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.arpitj007/tickler",
  "title": "Tickler",
  "description": "Self-hosted calendar your AI agents write to: follow-ups, deadlines, runs, with links back to each chat.",
  "repository": {
    "url": "https://github.com/arpitj007/tickler-server",
    "source": "github"
  },
  "websiteUrl": "https://docs.gettickler.com",
  "version": "1.0.0",
  "packages": [
    {
      "registryType": "oci",
      "identifier": "ghcr.io/arpitj007/tickler-server:1.0.0",
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:8787/mcp"
      },
      "environmentVariables": [
        {
          "name": "TICKLER_SECRET",
          "description": "Long random value used to encrypt provider keys. Keep it the same across updates.",
          "isRequired": true,
          "isSecret": true
        },
        {
          "name": "TICKLER_PUBLIC_URL",
          "description": "Public HTTPS address of this server, if it has one.",
          "isRequired": false
        }
      ]
    }
  ],
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://{host}/mcp",
      "variables": {
        "host": {
          "description": "Your own Tickler server's host name, e.g. tickler.your-name.workers.dev",
          "isRequired": true
        }
      },
      "headers": [
        {
          "name": "Authorization",
          "description": "Bearer token from your server's setup page (AI tools, New token). Not needed with OAuth.",
          "isRequired": false,
          "isSecret": true
        }
      ]
    }
  ]
}
```

Verify before publishing:

- `description` limit (keep under 100 characters; this one is 99).
- Whether `streamable-http` is accepted as a package transport (the docs' example uses `stdio`). If not, drop `transport.url` and set `"type": "stdio"` is **not** an option for us; publish the remote entry only.
- `mcp-publisher validate` passes.

## Steps

```
brew install mcp-publisher        # or download the release binary
mcp-publisher init                # creates server.json; replace with the draft above
mcp-publisher login github        # device login as arpitj007
mcp-publisher validate
mcp-publisher publish
```

Then check: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.arpitj007/tickler"`.

Optional later: publish from GitHub Actions on each release tag with GitHub OIDC login, so the registry stays in sync with the Docker image.

## Disclosure

The registry is a metadata index, not a community post, so no disclosure text is needed. Keep the description factual.
