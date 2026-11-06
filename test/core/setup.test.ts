import { describe, expect, it } from "vitest";
import { claim, cookieFrom, makeApp, PASS, SECRET } from "./helpers";

describe("/setup", () => {
  it("explains a missing TICKLER_SECRET", async () => {
    const t = makeApp({ env: { TICKLER_SECRET: "" } });
    expect(await (await t.req("/setup")).text()).toContain("TICKLER_SECRET");
  });

  it("first run needs the server secret and only works once", async () => {
    const t = makeApp();
    expect(await (await t.req("/setup")).text()).toContain("Create admin");
    const wrong = await t.form("/setup/claim", { secret: "nope", passphrase: PASS, passphrase2: PASS });
    expect(await wrong.text()).toContain("not this server");
    const short = await t.form("/setup/claim", { secret: SECRET, passphrase: "short", passphrase2: "short" });
    expect(await short.text()).toContain("at least");
    const cookie = await claim(t);
    expect(cookie).toMatch(/^tickler_session=tks_/);
    const again = await t.form("/setup/claim", { secret: SECRET, passphrase: "another passphrase", passphrase2: "another passphrase" });
    expect(again.headers.get("location")).toBe("/setup/login");
    const home = await (await t.req("/setup", { cookie })).text();
    expect(home).toContain("Your server");
    expect(home).not.toMatch(/—|–/); // no long dashes in UI text
  });

  it("login, wrong passphrase, rate limit, logout, redirect for signed-out pages", async () => {
    const t = makeApp();
    await claim(t);
    expect((await t.req("/setup/connect")).headers.get("location")).toBe("/setup/login?next=%2Fsetup%2Fconnect");
    expect(await (await t.form("/setup/login", { passphrase: "wrong one" })).text()).toContain("Wrong passphrase");
    const ok = await t.form("/setup/login", { passphrase: PASS, next: "/setup/connect" });
    expect(ok.headers.get("location")).toBe("/setup/connect");
    const cookie = cookieFrom(ok);
    const evil = await t.form("/setup/login", { passphrase: PASS, next: "//evil.example" });
    expect(evil.headers.get("location")).toBe("/setup");
    expect((await t.form("/setup/logout", {}, cookie)).status).toBe(302);
    expect((await t.req("/setup/connect", { cookie })).status).toBe(302);
    for (let i = 0; i < 10; i++) await t.form("/setup/login", { passphrase: "wrong", next: "" }, undefined);
    expect(await (await t.form("/setup/login", { passphrase: PASS })).text()).toContain("Too many attempts");
  });

  it("pages render: connect with token snippets, security, money", async () => {
    const t = makeApp();
    const cookie = await claim(t);
    const created = await (await t.form("/setup/tokens", { name: "Cursor" }, cookie)).text();
    const tok = /tkm_[A-Za-z0-9_-]{43}/.exec(created)![0];
    expect(created).toContain(`claude mcp add --transport http tickler http://tickler.test/mcp --header &quot;Authorization: Bearer ${tok}&quot;`);
    expect(created).toContain("bearer_token_env_var");
    const connect = await (await t.req("/setup/connect", { cookie })).text();
    expect(connect).toContain("tickler.create_entry");
    expect((await t.req("/setup/security", { cookie })).status).toBe(200);
    expect((await t.req("/setup/money", { cookie })).status).toBe(200);
    const changed = await t.form("/setup/passphrase", { passphrase: "a brand new pass", passphrase2: "a brand new pass" }, cookie);
    expect(changed.headers.get("location")).toContain("ok=passphrase");
    expect((await t.req("/setup/security", { cookie })).status).toBe(302); // old session signed out
  });

  it("passkey options need a session; login options need a passkey", async () => {
    const t = makeApp();
    const cookie = await claim(t);
    const opt = await t.req("/setup/webauthn/register/options", { method: "POST", cookie, json: {}, headers: { origin: "http://tickler.test" } });
    const body = await opt.json();
    expect(body.options.rp.id).toBe("tickler.test");
    expect(body.challenge_id).toBeTruthy();
    expect((await t.req("/setup/webauthn/register/options", { method: "POST", json: {} })).status).toBe(401);
    expect((await t.req("/setup/webauthn/login/options", { method: "POST", json: {} })).status).toBe(400);
  });
});
