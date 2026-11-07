import { describe, expect, it } from "vitest";
import { BASE, makeApp, mcp, pkce, SECRET } from "./helpers";

async function pairByKey(t: ReturnType<typeof makeApp>) {
  const r = await t.req("/api/pair", { method: "POST", json: { server_key: SECRET, device_name: "Phone", platform: "ios" } });
  return (await r.json()).token as string;
}

describe("connect this computer", () => {
  it("one command: script, single-use token exchange per tool, replaces tokens on re-run", async () => {
    const t = makeApp();
    const device = await pairByKey(t);
    const made = await (await t.req("/api/connect-codes", { method: "POST", token: device })).json();
    expect(made.command).toBe(`curl -fsSL ${BASE}/c/${made.code} | sh`);

    const script = await (await t.req(`/c/${made.code}`)).text();
    expect(script).toContain(`SERVER="${BASE}"`);
    expect(script).toContain("<!-- tickler -->");
    expect(script).not.toMatch(/__[A-Z_]+__/);
    expect(script).not.toContain("tkm_");

    const post = (code: string, clients: string) =>
      t.req(`/c/${code}`, { method: "POST", body: new URLSearchParams({ clients, computer: "MacBook" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const lines = (await (await post(made.code, "claude-code,cursor,nope")).text()).trim().split("\n");
    expect(lines.map((l) => l.split(" ")[0])).toEqual(["claude-code", "cursor"]);
    const claudeToken = lines[0]!.split(" ")[1]!;
    expect((await mcp(t, claudeToken, "tools/list")).status).toBe(200);

    expect((await post(made.code, "codex")).status).toBe(400);
    expect(await (await t.req(`/c/${made.code}`)).text()).toContain("expired or was already used");

    const again = await (await t.req("/api/connect-codes", { method: "POST", token: device })).json();
    await post(again.code, "claude-code");
    expect((await mcp(t, claudeToken, "tools/list")).status).toBe(401);
    const names = (await (await t.req("/api/tokens", { token: device })).json()).tokens.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(["Claude Code on MacBook", "Cursor on MacBook"]);
  });

  it("codes expire after 15 minutes", async () => {
    const t = makeApp();
    const device = await pairByKey(t);
    const { code } = await (await t.req("/api/connect-codes", { method: "POST", token: device })).json();
    t.advance(15 * 60_000 + 1);
    expect(await (await t.req(`/c/${code}`)).text()).toContain("expired");
  });
});

describe("approve OAuth connectors on the phone", () => {
  it("browser waits, phone allows, browser continues with a code once", async () => {
    const t = makeApp();
    const device = await pairByKey(t);
    const reg = await (await t.req("/oauth/register", { method: "POST", json: { client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] } })).json();
    const { challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/cb", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
    const page = await (await t.req(`/oauth/authorize?${q}`)).text();
    expect(page).toContain("Open the Tickler app");
    expect(page).not.toContain("Or sign in on this page"); // no admin yet
    const poll = /fetch\("([^"]+)"\)/.exec(page)![1]!;

    expect((await (await t.req(poll)).json()).status).toBe("pending");
    expect((await (await t.req(poll.replace(/s=[^&]+/, "s=wrong"))).json()).status).toBe("expired");

    const list = (await (await t.req("/api/approvals", { token: device })).json()).approvals;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ client_name: "Claude", redirect_host: "claude.ai" });
    expect(page).toContain(`>${list[0].match}<`);

    expect((await t.req(`/api/approvals/${list[0].id}`, { method: "POST", json: { decision: "allow" }, token: device })).status).toBe(204);
    expect((await (await t.req(poll)).json()).status).toBe("allowed");
    const cont = await t.req(poll.replace("?", "/continue?"));
    expect(cont.status).toBe(302);
    const loc = new URL(cont.headers.get("location")!);
    expect(loc.searchParams.get("state")).toBe("s1");
    expect(loc.searchParams.get("code")).toMatch(/^tka_/);
    expect((await t.req(poll.replace("?", "/continue?"))).status).toBe(200); // used up: error page
    expect((await (await t.req("/api/approvals", { token: device })).json()).approvals).toHaveLength(0);
  });

  it("deny redirects with access_denied", async () => {
    const t = makeApp();
    const device = await pairByKey(t);
    const reg = await (await t.req("/oauth/register", { method: "POST", json: { client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/cb"] } })).json();
    const { challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://chatgpt.com/cb", code_challenge: challenge, code_challenge_method: "S256" });
    const poll = /fetch\("([^"]+)"\)/.exec(await (await t.req(`/oauth/authorize?${q}`)).text())![1]!;
    const [a] = (await (await t.req("/api/approvals", { token: device })).json()).approvals;
    await t.req(`/api/approvals/${a.id}`, { method: "POST", json: { decision: "deny" }, token: device });
    const loc = new URL((await t.req(poll.replace("?", "/continue?"))).headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
  });
});
