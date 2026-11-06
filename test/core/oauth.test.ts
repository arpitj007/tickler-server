import { describe, expect, it } from "vitest";
import { BASE, claim, makeApp, mcp, pkce, tool } from "./helpers";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function register(t: ReturnType<typeof makeApp>, body: Record<string, unknown> = {}) {
  const r = await t.req("/oauth/register", { method: "POST", json: { client_name: "Claude", redirect_uris: [REDIRECT], ...body } });
  return { status: r.status, body: await r.json() };
}

function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st8",
    resource: `${BASE}/mcp`,
    scope: "mcp",
    ...extra,
  });
  return `/oauth/authorize?${q}`;
}

async function getCode(t: ReturnType<typeof makeApp>, cookie: string, clientId: string, challenge: string) {
  const q = new URL(`${BASE}${authorizeUrl(clientId, challenge)}`).searchParams;
  const form: Record<string, string> = Object.fromEntries(q);
  const r = await t.form("/oauth/authorize", { ...form, decision: "allow" }, cookie);
  expect(r.status).toBe(302);
  const loc = new URL(r.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get("state")).toBe("st8");
  expect(loc.searchParams.get("iss")).toBe(BASE);
  return loc.searchParams.get("code")!;
}

async function token(t: ReturnType<typeof makeApp>, data: Record<string, string>) {
  const r = await t.req("/oauth/token", { method: "POST", body: new URLSearchParams(data).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  return { status: r.status, body: await r.json() };
}

describe("OAuth 2.1 for MCP clients", () => {
  it("serves RFC 8414 and RFC 9728 metadata", async () => {
    const t = makeApp();
    const as = await (await t.req("/.well-known/oauth-authorization-server")).json();
    expect(as.issuer).toBe(BASE);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    const pr = await (await t.req("/.well-known/oauth-protected-resource/mcp")).json();
    expect(pr.resource).toBe(`${BASE}/mcp`);
    expect(pr.authorization_servers).toEqual([BASE]);
    expect((await (await t.req("/.well-known/oauth-protected-resource")).json()).resource).toBe(`${BASE}/mcp`);
  });

  it("end to end: register, login, consent, code + PKCE, MCP call, refresh rotation, revoke", async () => {
    const t = makeApp();
    const cookie = await claim(t);
    const reg = await register(t);
    expect(reg.status).toBe(201);
    const clientId = reg.body.client_id;
    expect(reg.body.client_secret).toBeUndefined();
    const { verifier, challenge } = await pkce();

    // Not signed in: the authorize page shows a login form that comes back here.
    const anon = await (await t.req(authorizeUrl(clientId, challenge))).text();
    expect(anon).toContain("Sign in");
    expect(anon).toContain("/oauth/authorize?");
    // Signed in: consent page.
    const consent = await (await t.req(authorizeUrl(clientId, challenge), { cookie })).text();
    expect(consent).toContain("Allow Claude?");

    const code = await getCode(t, cookie, clientId, challenge);
    const bad = await token(t, { grant_type: "authorization_code", code, code_verifier: "wrong".repeat(10), client_id: clientId, redirect_uri: REDIRECT });
    expect(bad.body.error).toBe("invalid_grant");
    const tok = await token(t, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: `${BASE}/mcp` });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toMatch(/^tko_/);
    expect(tok.body.token_type).toBe("Bearer");
    // codes are single use
    const reuse = await token(t, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId });
    expect(reuse.body.error).toBe("invalid_grant");

    const r = await tool(t, tok.body.access_token, "create_entry", { project: "Chat", title: "From Claude app", start_at: "2026-11-09T10:00:00Z" });
    expect(r.isError).toBe(false);
    const o = await t.storage.first<{ client: string }>("SELECT client FROM origins WHERE id = ?", [r.data.entry.origin_id]);
    expect(o!.client).toBe("claude_app"); // inferred from the OAuth client name
    const act = await t.storage.first<{ actor_type: string }>("SELECT actor_type FROM activity WHERE action = 'create_entry'");
    expect(act!.actor_type).toBe("oauth_client");

    const ref = await token(t, { grant_type: "refresh_token", refresh_token: tok.body.refresh_token, client_id: clientId });
    expect(ref.status).toBe(200);
    expect(ref.body.refresh_token).not.toBe(tok.body.refresh_token);
    const refAgain = await token(t, { grant_type: "refresh_token", refresh_token: tok.body.refresh_token, client_id: clientId });
    expect(refAgain.body.error).toBe("invalid_grant");

    // access tokens expire
    t.advance(3601_000);
    expect((await mcp(t, tok.body.access_token, "tools/list")).status).toBe(401);
    expect((await mcp(t, ref.body.access_token, "tools/list")).status).toBe(401);

    // revoking the client kills its tokens
    const ref2 = await token(t, { grant_type: "refresh_token", refresh_token: ref.body.refresh_token, client_id: clientId });
    expect((await mcp(t, ref2.body.access_token, "tools/list")).status).toBe(200);
    expect((await t.form(`/setup/oauth-clients/${clientId}/revoke`, {}, cookie)).status).toBe(302);
    expect((await mcp(t, ref2.body.access_token, "tools/list")).status).toBe(401);
  });

  it("rejects bad requests: no PKCE, plain method, unregistered redirect, wrong resource, deny", async () => {
    const t = makeApp();
    const cookie = await claim(t);
    const { body } = await register(t);
    const { challenge } = await pkce();
    const noPkce = await t.req(authorizeUrl(body.client_id, challenge, { code_challenge_method: "plain" }), { cookie });
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const badRedirect = await t.req(authorizeUrl(body.client_id, challenge, { redirect_uri: "https://evil.example/cb" }), { cookie });
    expect(badRedirect.status).toBe(200); // error page, never a redirect to an unknown URI
    expect(await badRedirect.text()).toContain("redirect");
    const badRes = await t.req(authorizeUrl(body.client_id, challenge, { resource: "https://other.example/mcp" }), { cookie });
    expect(new URL(badRes.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
    const q = Object.fromEntries(new URL(`${BASE}${authorizeUrl(body.client_id, challenge)}`).searchParams);
    const deny = await t.form("/oauth/authorize", { ...q, decision: "deny" }, cookie);
    expect(new URL(deny.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    // consent POST without a session
    expect((await t.form("/oauth/authorize", { ...q, decision: "allow" })).status).toBe(401);
    expect((await register(t, { redirect_uris: ["javascript:alert(1)"] })).body.error).toBe("invalid_redirect_uri");
    expect((await register(t, { redirect_uris: ["http://example.com/cb"] })).body.error).toBe("invalid_redirect_uri");
    expect((await register(t, { redirect_uris: ["http://127.0.0.1:3000/cb"] })).status).toBe(201);
  });

  it("confidential clients authenticate with client_secret_basic", async () => {
    const t = makeApp();
    const cookie = await claim(t);
    const { body } = await register(t, { token_endpoint_auth_method: "client_secret_basic" });
    expect(body.client_secret).toMatch(/^tkc_/);
    const { verifier, challenge } = await pkce();
    const code = await getCode(t, cookie, body.client_id, challenge);
    const noAuth = await token(t, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: body.client_id });
    expect(noAuth.status).toBe(401);
    const r = await t.req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${body.client_id}:${body.client_secret}`)}` },
    });
    expect(r.status).toBe(200);
  });

  it("client ID metadata documents", async () => {
    const docUrl = "https://client.example/oauth/metadata.json";
    const t = makeApp({
      fetch: (async (u: string) =>
        new Response(JSON.stringify({ client_id: docUrl, client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }), {
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
    const cookie = await claim(t);
    const { verifier, challenge } = await pkce();
    const page = await (await t.req(authorizeUrl(docUrl, challenge), { cookie })).text();
    expect(page).toContain("Allow ChatGPT?");
    const code = await getCode(t, cookie, docUrl, challenge);
    const tok = await token(t, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: docUrl });
    expect(tok.status).toBe(200);
  });
});
