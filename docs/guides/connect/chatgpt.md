# Connect ChatGPT

ChatGPT can use Tickler through a **custom MCP connector**. OpenAI changes where this lives and who can use it fairly often, so check the current state in ChatGPT's help pages if a menu below looks different.

**Before you start:**

- Your server needs a public HTTPS address. On Cloudflare you have one already. On Docker, set up [Cloudflare Tunnel](../public-url-cloudflare-tunnel.md) or [Tailscale Funnel](../public-url-tailscale-funnel.md).
- Your ChatGPT plan must allow custom MCP connectors that can **write** (Tickler adds entries, so read-only isn't enough). At the time of writing this is available in **developer mode** on web, for Business, Enterprise and Edu workspaces where an admin has turned it on, and with more limits on some personal plans.

**Time:** about 5 minutes.

## Step 1: Turn on developer mode

In ChatGPT on the web, open **Settings**, then **Apps** (or **Connectors**), then **Advanced settings**, and turn on **Developer mode**. In a workspace, an admin may need to allow it first.

## Step 2: Add Tickler

1. In **Settings**, then **Apps**, press **Create** (or **Add custom MCP server**).
2. Name: `Tickler`
3. MCP server URL:

```
{{SERVER_URL}}/mcp
```

4. Authentication: **OAuth**.
5. Accept the notice about custom connectors and press **Create**.

## Step 3: Sign in to your own server

ChatGPT opens a page from **your own server**. Log in with your passkey or passphrase and press **Allow**. Your server gives ChatGPT its own key, which you can revoke in setup under **AI tools**, then **Connected apps**.

## Step 4: Use it in a chat

Start a chat, choose **Developer mode** (or pick Tickler from the tools menu), and ask:

```
Use Tickler to add an entry for next Tuesday at 11:00: follow up with the designer about the icon, project App.
```

ChatGPT asks you to confirm each write. That's expected.

## Step 5 (optional): Add the instruction block

Paste the [instruction block](../instruction-block.md) into a Project's instructions or into **Customize ChatGPT**.

## Origins from ChatGPT

ChatGPT doesn't tell connectors which chat a request came from. Entries show the chat's topic as their title, and the app offers **Open ChatGPT** with that title copied, so you can find the chat with search.
