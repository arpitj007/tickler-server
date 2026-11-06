/** @jsxImportSource hono/jsx */
// /setup: first-run admin, login (passphrase or passkey), pairing QR, devices, AI tool tokens and
// snippets, provider credentials, OAuth clients. Server rendered, no build step.
// WebAuthn via @simplewebauthn/server v14 (https://simplewebauthn.dev/docs/packages/server, checked 2026-11-06).
import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { raw } from "hono/html";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { renderSVG } from "uqr";
import { listActivity } from "../core/activity";
import {
  ADMIN, changePassphrase, checkPassphrase, createAdmin, createSession, destroySession, getAdmin, listPasskeys,
  MIN_PASSPHRASE, saveChallenge, SESSION_COOKIE, SESSION_TTL_MS, takeChallenge, validSession,
} from "../core/admin";
import { connectClients, INSTRUCTION_BLOCK } from "../core/connect";
import {
  createPairingCode, createToken, listDevices, listOAuthClients, listTokens, PAIRING_TTL_MS, revokeDevice, revokeOAuthClient, revokeToken,
} from "../core/devices";
import { deleteProviderConfig, readProviderConfig, saveProviderConfig } from "../core/moneyStore";
import { findProvider, listProviderStatuses, providerStatus, syncProvider, testProvider } from "../core/moneyService";
import { rateLimit } from "../core/rateLimit";
import { ApiError, fromB64url, timingSafeEqual } from "../core/util";
import { logActivity } from "../core/activity";
import { clientIp, type C, type Env } from "../routes/http";
import { Copy, Flash, Layout, PostButton } from "./layout";

export const setup = new Hono<Env>();

const MESSAGES: Record<string, string> = {
  claimed: "Your server is ready. Pair your phone next.",
  revoked: "Revoked.",
  saved: "Saved.",
  deleted: "Deleted.",
  passkey: "Passkey added.",
  passphrase: "Passphrase changed. Other sessions were signed out.",
  synced: "Sync finished.",
};

function page(c: C, title: string, body: unknown, nav = true) {
  return c.html(
    <Layout title={title} nav={nav} serverName={c.get("ctx").config.serverName}>
      {body as never}
    </Layout>,
  );
}

const isHttps = (c: C) => c.get("baseUrl").startsWith("https://");

function setSessionCookie(c: C, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax", // Lax so the OAuth consent page (a top-level GET from the client) sees the session
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function isAdmin(c: C): Promise<boolean> {
  return validSession(c.get("ctx"), getCookie(c, SESSION_COOKIE));
}

function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/setup";
}

// Every /setup request is rate limited per IP; logins more strictly below.
setup.use("*", async (c, next) => {
  await rateLimit(c.get("ctx"), `setup:${clientIp(c)}`, 240, 60);
  await next();
});

const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!(await isAdmin(c))) {
    if (c.req.method === "GET") return c.redirect(`/setup/login?next=${encodeURIComponent(c.req.path)}`);
    throw new ApiError(401, "unauthorized", "Sign in again");
  }
  await next();
};

// ---------- first run and login

function NoSecret() {
  return (
    <div class="card">
      <h1>One more step</h1>
      <p>
        This server has no <code>TICKLER_SECRET</code>. It encrypts your provider keys and proves you own the server.
      </p>
      <p>On Cloudflare: Workers and Pages, your worker, Settings, Variables and Secrets, add a secret named TICKLER_SECRET with a long random value, then reload this page.</p>
      <Copy text={"npx wrangler secret put TICKLER_SECRET"} />
    </div>
  );
}

setup.get("/", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.config.secret) return page(c, "Setup", <NoSecret />, false);
  if (!(await getAdmin(ctx))) return page(c, "Welcome", <ClaimForm />, false);
  if (!(await isAdmin(c))) return c.redirect("/setup/login");
  return overview(c);
});

function ClaimForm(props: { error?: string }) {
  return (
    <div class="card">
      <h1>Welcome to your Tickler server</h1>
      <p class="muted">
        Create the admin login. To prove this is your server, enter the TICKLER_SECRET you set when you deployed it (on Docker it
        is in the container log and in the data folder as <code>secret</code>).
      </p>
      <Flash error={props.error} />
      <form method="post" action="/setup/claim">
        <label for="secret">TICKLER_SECRET</label>
        <input id="secret" name="secret" type="password" autocomplete="off" required />
        <label for="pass">Admin passphrase (at least {MIN_PASSPHRASE} characters)</label>
        <input id="pass" name="passphrase" type="password" autocomplete="new-password" minlength={MIN_PASSPHRASE} required />
        <label for="pass2">Repeat passphrase</label>
        <input id="pass2" name="passphrase2" type="password" autocomplete="new-password" required />
        <p class="muted">You can add a passkey after this step.</p>
        <button type="submit">Create admin</button>
      </form>
    </div>
  );
}

setup.post("/claim", async (c) => {
  const ctx = c.get("ctx");
  await rateLimit(ctx, `login:${clientIp(c)}`, 10, 900);
  if (!ctx.config.secret) return page(c, "Setup", <NoSecret />, false);
  if (await getAdmin(ctx)) return c.redirect("/setup/login");
  const f = await c.req.parseBody();
  const secret = String(f.secret ?? "");
  const pass = String(f.passphrase ?? "");
  if (!timingSafeEqual(secret.trim(), ctx.config.secret)) return page(c, "Welcome", <ClaimForm error="That is not this server's TICKLER_SECRET." />, false);
  if (pass.length < MIN_PASSPHRASE) return page(c, "Welcome", <ClaimForm error={`Use at least ${MIN_PASSPHRASE} characters.`} />, false);
  if (pass !== String(f.passphrase2 ?? "")) return page(c, "Welcome", <ClaimForm error="The passphrases don't match." />, false);
  if (!(await createAdmin(ctx, pass))) return c.redirect("/setup/login");
  setSessionCookie(c, await createSession(ctx));
  return c.redirect("/setup?ok=claimed");
});

const PASSKEY_JS = `
const b64u={e:b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''),
d:s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0))};
async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});const j=await r.json();if(!r.ok)throw new Error(j.error?j.error.message:'Failed');return j}
async function passkeyLogin(next){try{const {options,challenge_id}=await post('/setup/webauthn/login/options');
options.challenge=b64u.d(options.challenge);(options.allowCredentials||[]).forEach(c=>c.id=b64u.d(c.id));
const cr=await navigator.credentials.get({publicKey:options});const r=cr.response;
await post('/setup/webauthn/login/verify',{challenge_id,response:{id:cr.id,rawId:b64u.e(cr.rawId),type:cr.type,clientExtensionResults:cr.getClientExtensionResults(),authenticatorAttachment:cr.authenticatorAttachment,
response:{clientDataJSON:b64u.e(r.clientDataJSON),authenticatorData:b64u.e(r.authenticatorData),signature:b64u.e(r.signature),userHandle:r.userHandle?b64u.e(r.userHandle):undefined}}});
location.href=next||'/setup'}catch(e){document.getElementById('pk-err').innerText=e.message}}
async function passkeyRegister(){try{const name=document.getElementById('pk-name').value||'Passkey';const {options,challenge_id}=await post('/setup/webauthn/register/options');
options.challenge=b64u.d(options.challenge);options.user.id=b64u.d(options.user.id);(options.excludeCredentials||[]).forEach(c=>c.id=b64u.d(c.id));
const cr=await navigator.credentials.create({publicKey:options});const r=cr.response;
await post('/setup/webauthn/register/verify',{challenge_id,name,response:{id:cr.id,rawId:b64u.e(cr.rawId),type:cr.type,clientExtensionResults:cr.getClientExtensionResults(),authenticatorAttachment:cr.authenticatorAttachment,
response:{clientDataJSON:b64u.e(r.clientDataJSON),attestationObject:b64u.e(r.attestationObject),transports:r.getTransports?r.getTransports():[]}}});
location.href='/setup/security?ok=passkey'}catch(e){document.getElementById('pk-err').innerText=e.message}}
`;

export function LoginForm(props: { next: string; error?: string | null; hasPasskeys: boolean; action?: string }) {
  return (
    <div class="card">
      <h1>Sign in</h1>
      <Flash error={props.error} />
      {props.hasPasskeys ? (
        <div style="margin-bottom:12px">
          <button type="button" onclick={`passkeyLogin(${JSON.stringify(props.next)})`}>
            Sign in with a passkey
          </button>
          <p class="muted" id="pk-err"></p>
        </div>
      ) : null}
      <form method="post" action={props.action ?? "/setup/login"}>
        <input type="hidden" name="next" value={props.next} />
        <label for="pass">Admin passphrase</label>
        <input id="pass" name="passphrase" type="password" autocomplete="current-password" required />
        <div style="margin-top:12px">
          <button type="submit" class={props.hasPasskeys ? "secondary" : ""}>
            Sign in
          </button>
        </div>
      </form>
      <script>{raw(PASSKEY_JS)}</script>
    </div>
  );
}

setup.get("/login", async (c) => {
  const ctx = c.get("ctx");
  if (!(await getAdmin(ctx))) return c.redirect("/setup");
  const next = safeNext(c.req.query("next"));
  if (await isAdmin(c)) return c.redirect(next);
  return page(c, "Sign in", <LoginForm next={next} hasPasskeys={(await listPasskeys(ctx)).length > 0} />, false);
});

setup.post("/login", async (c) => {
  const ctx = c.get("ctx");
  const f = await c.req.parseBody();
  const next = safeNext(String(f.next ?? ""));
  try {
    await rateLimit(ctx, `login:${clientIp(c)}`, 10, 900);
  } catch {
    return page(c, "Sign in", <LoginForm next={next} error="Too many attempts. Wait 15 minutes." hasPasskeys={false} />, false);
  }
  if (!(await checkPassphrase(ctx, String(f.passphrase ?? "")))) {
    await logActivity(ctx, { type: "admin", id: null, name: clientIp(c) }, "login_failed", "Wrong passphrase");
    return page(c, "Sign in", <LoginForm next={next} error="Wrong passphrase." hasPasskeys={(await listPasskeys(ctx)).length > 0} />, false);
  }
  setSessionCookie(c, await createSession(ctx));
  return c.redirect(next);
});

setup.post("/logout", async (c) => {
  await destroySession(c.get("ctx"), getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/setup/login");
});

// ---------- passkeys

function rp(c: C) {
  const u = new URL(c.get("baseUrl"));
  return { rpID: u.hostname, origin: u.origin };
}

setup.post("/webauthn/login/options", async (c) => {
  const ctx = c.get("ctx");
  await rateLimit(ctx, `login:${clientIp(c)}`, 10, 900);
  const keys = await listPasskeys(ctx);
  if (!keys.length) throw new ApiError(400, "bad_request", "No passkeys yet");
  const options = await generateAuthenticationOptions({
    rpID: rp(c).rpID,
    userVerification: "preferred",
    allowCredentials: keys.map((k) => ({ id: k.id, transports: k.transports ? (JSON.parse(k.transports) as never[]) : undefined })),
  });
  return c.json({ options, challenge_id: await saveChallenge(ctx, options.challenge, "login") });
});

setup.post("/webauthn/login/verify", async (c) => {
  const ctx = c.get("ctx");
  const b = (await c.req.json()) as { challenge_id?: string; response?: { id?: string } };
  const challenge = await takeChallenge(ctx, b.challenge_id, "login");
  const key = (await listPasskeys(ctx)).find((k) => k.id === b.response?.id);
  if (!challenge || !key) throw new ApiError(401, "unauthorized", "Passkey sign-in failed. Try again.");
  const { rpID, origin } = rp(c);
  const v = await verifyAuthenticationResponse({
    response: b.response as never,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: key.id, publicKey: Uint8Array.from(atob(key.public_key), (ch) => ch.charCodeAt(0)), counter: key.counter },
  }).catch(() => ({ verified: false as const, authenticationInfo: undefined }));
  if (!v.verified) throw new ApiError(401, "unauthorized", "Passkey sign-in failed.");
  await ctx.storage.run("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?", [v.authenticationInfo.newCounter, ctx.now().toISOString(), key.id]);
  setSessionCookie(c, await createSession(ctx));
  return c.json({ ok: true });
});

setup.post("/webauthn/register/options", requireAdmin, async (c) => {
  const ctx = c.get("ctx");
  const admin = (await getAdmin(ctx))!;
  const keys = await listPasskeys(ctx);
  const options = await generateRegistrationOptions({
    rpName: "Tickler",
    rpID: rp(c).rpID,
    userName: `admin@${rp(c).rpID}`,
    userDisplayName: `Tickler admin (${ctx.config.serverName})`,
    userID: fromB64url(admin.webauthn_user_id),
    attestationType: "none",
    excludeCredentials: keys.map((k) => ({ id: k.id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  return c.json({ options, challenge_id: await saveChallenge(ctx, options.challenge, "register") });
});

setup.post("/webauthn/register/verify", requireAdmin, async (c) => {
  const ctx = c.get("ctx");
  const b = (await c.req.json()) as { challenge_id?: string; name?: string; response?: unknown };
  const challenge = await takeChallenge(ctx, b.challenge_id, "register");
  if (!challenge) throw new ApiError(400, "bad_request", "The request expired. Try again.");
  const { rpID, origin } = rp(c);
  const v = await verifyRegistrationResponse({ response: b.response as never, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID }).catch(
    (e: Error) => {
      throw new ApiError(400, "bad_request", e.message);
    },
  );
  if (!v.verified) throw new ApiError(400, "bad_request", "Passkey could not be verified");
  const cred = v.registrationInfo.credential;
  let bin = "";
  for (const x of cred.publicKey) bin += String.fromCharCode(x);
  await ctx.storage.run(
    "INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [cred.id, btoa(bin), cred.counter, JSON.stringify(cred.transports ?? []), String(b.name ?? "Passkey").slice(0, 60), ctx.now().toISOString()],
  );
  await logActivity(ctx, ADMIN, "add_passkey", `Passkey "${b.name ?? "Passkey"}" added`);
  return c.json({ ok: true });
});

// Everything below needs the admin session.
setup.use("*", async (c, next) => {
  if (c.req.path === "/setup" || c.req.path === "/setup/") return next();
  return requireAdmin(c, next);
});

// ---------- overview

async function overview(c: C) {
  const ctx = c.get("ctx");
  const [devices, tokens, clients, activity] = await Promise.all([
    listDevices(ctx),
    listTokens(ctx),
    listOAuthClients(ctx),
    listActivity(ctx, null, 15),
  ]);
  const ok = MESSAGES[c.req.query("ok") ?? ""];
  return page(
    c,
    "Overview",
    <>
      <Flash ok={ok} />
      <div class="card">
        <h2>Your server</h2>
        <p>
          URL: <code>{c.get("baseUrl")}</code>
        </p>
        {!ctx.config.publicUrl ? (
          <p class="muted">Tip: set TICKLER_PUBLIC_URL so links and the QR code always use your public address.</p>
        ) : null}
        <div class="row">
          <a class="btn" href="/setup/pair">
            Pair a phone
          </a>
          <a class="btn secondary" href="/setup/connect">
            Connect AI tools
          </a>
        </div>
      </div>
      <div class="card">
        <h2>Phones</h2>
        {devices.length ? (
          <ul class="list">
            {devices.map((d) => (
              <li class="spread">
                <span>
                  {d.name} <span class="pill">{d.platform}</span>
                  <br />
                  <span class="muted">Last seen {d.last_seen_at ?? "never"}</span>
                </span>
                <PostButton action={`/setup/devices/${d.id}/revoke`} label="Revoke" danger confirm={`Revoke ${d.name}?`} />
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">No phones paired yet.</p>
        )}
      </div>
      <div class="card">
        <h2>AI tool tokens</h2>
        {tokens.length ? (
          <ul class="list">
            {tokens.map((t) => (
              <li class="spread">
                <span>
                  {t.name}
                  <br />
                  <span class="muted">Last used {t.last_used_at ?? "never"}</span>
                </span>
                <PostButton action={`/setup/tokens/${t.id}/revoke`} label="Revoke" danger confirm={`Revoke ${t.name}?`} />
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">No tokens yet.</p>
        )}
        <h2 style="margin-top:16px">OAuth apps</h2>
        {clients.length ? (
          <ul class="list">
            {clients.map((t) => (
              <li class="spread">
                <span>
                  {t.name}
                  <br />
                  <span class="muted">Last used {t.last_used_at ?? "never"}</span>
                </span>
                <PostButton action={`/setup/oauth-clients/${t.id}/revoke`} label="Revoke" danger confirm={`Revoke ${t.name}?`} />
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">Claude apps and ChatGPT appear here after they connect.</p>
        )}
      </div>
      <div class="card">
        <h2>Recent activity</h2>
        <ul class="list">
          {activity.map((a) => (
            <li>
              <span class="muted">{String(a.at).slice(0, 16).replace("T", " ")}</span> {String(a.actor_name ?? a.actor_type)}:{" "}
              {String(a.summary ?? a.action)}
            </li>
          ))}
        </ul>
      </div>
      <form method="post" action="/setup/logout">
        <button class="secondary" type="submit">
          Sign out
        </button>
      </form>
    </>,
  );
}

setup.post("/devices/:id/revoke", async (c) => {
  await revokeDevice(c.get("ctx"), c.req.param("id"), ADMIN);
  return c.redirect("/setup?ok=revoked");
});
setup.post("/tokens/:id/revoke", async (c) => {
  await revokeToken(c.get("ctx"), c.req.param("id"), ADMIN);
  return c.redirect("/setup?ok=revoked");
});
setup.post("/oauth-clients/:id/revoke", async (c) => {
  await revokeOAuthClient(c.get("ctx"), c.req.param("id"), ADMIN);
  return c.redirect("/setup?ok=revoked");
});

// ---------- pairing

setup.get("/pair", async (c) => {
  const ctx = c.get("ctx");
  const base = c.get("baseUrl");
  const { code, expires_at } = await createPairingCode(ctx, ADMIN);
  const payload = `tickler://pair?url=${encodeURIComponent(base)}&code=${code}`;
  const svg = renderSVG(payload, { border: 2, ecc: "M" });
  return page(
    c,
    "Pair a phone",
    <div class="card">
      <h1>Pair a phone</h1>
      <p>In the Tickler app, choose "Set up my server", then "Scan QR code".</p>
      <div class="qr">{raw(svg)}</div>
      <p class="muted">Or enter it by hand:</p>
      <p>
        Server URL: <code>{base}</code>
      </p>
      <p class="code">{code}</p>
      <p class="muted">
        Valid for {PAIRING_TTL_MS / 60000} minutes and one phone (until {expires_at.slice(11, 16)} UTC).
      </p>
      <a class="btn secondary" href="/setup/pair">
        New code
      </a>
      {base.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(base) ? (
        <p class="muted">This server is on plain http. Phones off your network need a public https URL (see the Tunnel guide).</p>
      ) : null}
    </div>,
  );
});

// ---------- AI tools

function ConnectPage(props: { base: string; token?: string; tokenName?: string }) {
  const clients = connectClients(props.base, props.token ?? "<TOKEN>");
  return (
    <>
      {props.token ? (
        <div class="card">
          <h1>Token for {props.tokenName}</h1>
          <p>Copy it now. It is shown only once; the snippets below already contain it.</p>
          <Copy text={props.token} />
        </div>
      ) : (
        <div class="card">
          <h1>Connect your AI tools</h1>
          <p>Create a token for each tool (so you can revoke them one by one). Claude apps and ChatGPT sign in with OAuth instead and need no token.</p>
          <form method="post" action="/setup/tokens" class="row">
            <input name="name" placeholder="Name, e.g. Claude Code on my Mac" required style="flex:1;min-width:200px" />
            <button type="submit">Create token</button>
          </form>
        </div>
      )}
      {clients.map((cl) => (
        <div class="card">
          <details open={!!props.token && cl.auth === "token" ? true : undefined}>
            <summary>
              {cl.name} <span class="pill">{cl.auth === "oauth" ? "OAuth" : "token"}</span>
            </summary>
            <Copy text={cl.snippet} />
            {cl.note ? <p class="muted">{cl.note}</p> : null}
            <p class="muted">
              <a href={cl.docs}>Step by step guide</a>
            </p>
          </details>
        </div>
      ))}
      <div class="card">
        <h2>Instructions for your agents</h2>
        <p class="muted">Paste into CLAUDE.md, AGENTS.md or your Cursor rules.</p>
        <Copy text={INSTRUCTION_BLOCK} />
      </div>
      <div class="card">
        <h2>Claude Code origin hook</h2>
        <p class="muted">
          Links every entry back to the session that created it, with a working resume command. See hooks/claude-code/README.md in
          the tickler-server repo.
        </p>
      </div>
    </>
  );
}

setup.get("/connect", (c) => page(c, "AI tools", <ConnectPage base={c.get("baseUrl")} />));

setup.post("/tokens", async (c) => {
  const f = await c.req.parseBody();
  const { token, secret } = await createToken(c.get("ctx"), String(f.name ?? "MCP client"), ADMIN);
  c.header("cache-control", "no-store");
  return page(c, "New token", <ConnectPage base={c.get("baseUrl")} token={secret} tokenName={token.name} />);
});

// ---------- money providers

setup.get("/money", async (c) => {
  const ctx = c.get("ctx");
  const statuses = await listProviderStatuses(ctx, c.get("baseUrl"));
  const ok = MESSAGES[c.req.query("ok") ?? ""];
  return page(
    c,
    "Money",
    <>
      <Flash ok={ok} />
      <div class="card">
        <h1>Money sources</h1>
        <p class="muted">
          Keys are encrypted on this server and never leave it. Create read-only keys; each guide shows the exact scopes.
        </p>
        {ctx.providers.length ? (
          <ul class="list">
            {ctx.providers.map((p) => {
              const s = statuses.find((x) => x.provider === p.id);
              return (
                <li class="spread">
                  <span>
                    <a href={`/setup/money/${p.id}`}>{p.displayName}</a> <span class="pill">{p.kind}</span>{" "}
                    {s?.configured ? (
                      s.last_error ? (
                        <span class="pill err">error</span>
                      ) : (
                        <span class="pill ok">connected</span>
                      )
                    ) : null}
                    <br />
                    <span class="muted">
                      {p.freshness}
                      {s?.last_sync_at ? `, last sync ${s.last_sync_at.slice(0, 16).replace("T", " ")}` : ""}
                    </span>
                  </span>
                  <a class="btn secondary" href={`/setup/money/${p.id}`}>
                    {s?.configured ? "Edit" : "Connect"}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="muted">No money adapters are installed in this build.</p>
        )}
      </div>
    </>,
  );
});

setup.get("/money/:provider", async (c) => {
  const ctx = c.get("ctx");
  const p = findProvider(ctx, c.req.param("provider"));
  if (!p) return c.notFound();
  const status = await providerStatus(ctx, p.id, c.get("baseUrl"));
  const cfg = (await readProviderConfig(ctx, p.id).catch(() => null)) ?? {};
  const q = c.req.query();
  return page(
    c,
    p.displayName,
    <div class="card">
      <h1>{p.displayName}</h1>
      <Flash ok={MESSAGES[q.ok ?? ""] ?? (q.test === "ok" ? `Connected: ${q.msg ?? ""}` : null)} error={q.test === "fail" ? `Test failed: ${q.msg ?? ""}` : null} />
      <p class="muted">
        Updates: {p.freshness}. <a href={`https://github.com/arpitj007/tickler-server/blob/main/docs/${p.guide}.md`}>Guide: create a read-only key</a>
      </p>
      {p.needsPublicUrl && !status.public_url_ok ? <p class="flash error">Needs a public https URL for webhooks (set TICKLER_PUBLIC_URL).</p> : null}
      {p.needsPublicUrl ? (
        <p class="muted">
          Webhook URL: <code>{`${c.get("baseUrl")}/hooks/${p.id}`}</code>
        </p>
      ) : null}
      {status.last_error ? <p class="flash error">Last sync error: {status.last_error}</p> : null}
      <form method="post" action={`/setup/money/${p.id}`}>
        {p.fields.map((f) => {
          const has = cfg[f.key] !== undefined && cfg[f.key] !== "";
          const placeholder = has ? (f.secret ? "Saved. Leave empty to keep it." : "") : f.optional ? "Optional" : "";
          return (
            <>
              <label for={f.key}>{f.label}</label>
              {f.multiline ? (
                <textarea id={f.key} name={f.key} placeholder={placeholder} autocomplete="off">
                  {!f.secret && has ? cfg[f.key] : ""}
                </textarea>
              ) : (
                <input
                  id={f.key}
                  name={f.key}
                  type={f.secret ? "password" : "text"}
                  autocomplete="off"
                  placeholder={placeholder}
                  value={!f.secret && has ? cfg[f.key] : ""}
                />
              )}
              {f.help ? <p class="muted">{f.help}</p> : null}
            </>
          );
        })}
        <label>
          <input type="checkbox" name="enabled" value="1" checked={status.enabled || !status.configured} style="width:auto" /> Enabled
        </label>
        <div class="row" style="margin-top:12px">
          <button type="submit">Save</button>
        </div>
      </form>
      {status.configured ? (
        <div class="row" style="margin-top:12px">
          <PostButton action={`/setup/money/${p.id}/test`} label="Test" />
          <PostButton action={`/setup/money/${p.id}/sync`} label="Sync now" />
          <PostButton action={`/setup/money/${p.id}/delete`} label="Remove" danger confirm="Remove these credentials?" />
        </div>
      ) : null}
    </div>,
  );
});

setup.post("/money/:provider", async (c) => {
  const ctx = c.get("ctx");
  const p = findProvider(ctx, c.req.param("provider"));
  if (!p) return c.notFound();
  const f = await c.req.parseBody();
  const creds: Record<string, string> = {};
  for (const field of p.fields) if (typeof f[field.key] === "string") creds[field.key] = f[field.key] as string;
  await saveProviderConfig(ctx, p.id, creds, f.enabled === "1", ADMIN);
  return c.redirect(`/setup/money/${p.id}?ok=saved`);
});

setup.post("/money/:provider/test", async (c) => {
  const id = c.req.param("provider");
  const r = await testProvider(c.get("ctx"), id);
  return c.redirect(`/setup/money/${id}?test=${r.ok ? "ok" : "fail"}&msg=${encodeURIComponent(r.message.slice(0, 300))}`);
});

setup.post("/money/:provider/sync", async (c) => {
  const id = c.req.param("provider");
  const ctx = c.get("ctx");
  await rateLimit(ctx, `sync:${id}`, 6, 600);
  await syncProvider(ctx, id);
  return c.redirect(`/setup/money/${id}?ok=synced`);
});

setup.post("/money/:provider/delete", async (c) => {
  await deleteProviderConfig(c.get("ctx"), c.req.param("provider"), ADMIN);
  return c.redirect("/setup/money?ok=deleted");
});

// ---------- security: passkeys, passphrase

setup.get("/security", async (c) => {
  const ctx = c.get("ctx");
  const keys = await listPasskeys(ctx);
  const q = c.req.query();
  return page(
    c,
    "Security",
    <>
      <Flash ok={MESSAGES[q.ok ?? ""]} error={q.error === "short" ? `Use at least ${MIN_PASSPHRASE} characters.` : q.error === "match" ? "The passphrases don't match." : null} />
      <div class="card">
        <h2>Passkeys</h2>
        {keys.length ? (
          <ul class="list">
            {keys.map((k) => (
              <li class="spread">
                <span>
                  {k.name}
                  <br />
                  <span class="muted">Added {k.created_at.slice(0, 10)}, last used {k.last_used_at?.slice(0, 10) ?? "never"}</span>
                </span>
                <PostButton action={`/setup/passkeys/${encodeURIComponent(k.id)}/delete`} label="Remove" danger confirm="Remove this passkey?" />
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">No passkeys yet. Your passphrase always works too.</p>
        )}
        <label for="pk-name">Name</label>
        <div class="row">
          <input id="pk-name" placeholder="e.g. iPhone, MacBook" style="flex:1;min-width:180px" />
          <button type="button" onclick="passkeyRegister()">
            Add a passkey
          </button>
        </div>
        <p class="muted" id="pk-err"></p>
        <script>{raw(PASSKEY_JS)}</script>
      </div>
      <div class="card">
        <h2>Change passphrase</h2>
        <form method="post" action="/setup/passphrase">
          <label for="p1">New passphrase</label>
          <input id="p1" name="passphrase" type="password" autocomplete="new-password" minlength={MIN_PASSPHRASE} required />
          <label for="p2">Repeat</label>
          <input id="p2" name="passphrase2" type="password" autocomplete="new-password" required />
          <div style="margin-top:12px">
            <button type="submit">Change</button>
          </div>
        </form>
      </div>
    </>,
  );
});

setup.post("/passkeys/:id/delete", async (c) => {
  const ctx = c.get("ctx");
  await ctx.storage.run("DELETE FROM passkeys WHERE id = ?", [decodeURIComponent(c.req.param("id"))]);
  await logActivity(ctx, ADMIN, "remove_passkey", "Passkey removed");
  return c.redirect("/setup/security?ok=deleted");
});

setup.post("/passphrase", async (c) => {
  const f = await c.req.parseBody();
  const p = String(f.passphrase ?? "");
  if (p.length < MIN_PASSPHRASE) return c.redirect("/setup/security?error=short");
  if (p !== String(f.passphrase2 ?? "")) return c.redirect("/setup/security?error=match");
  const ctx = c.get("ctx");
  await changePassphrase(ctx, p);
  setSessionCookie(c, await createSession(ctx));
  return c.redirect("/setup/security?ok=passphrase");
});

