/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { raw } from "hono/html";

const CSS = `
:root{--bg:#f7f7f8;--card:#fff;--fg:#1c1c1e;--muted:#6b6b73;--line:#e3e3e8;--accent:#5b5bd6;--danger:#d93036;--ok:#2f8f5b;--code:#f0f0f3}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1c1c1f;--fg:#ededef;--muted:#9b9ba3;--line:#2e2e33;--accent:#8f8ff0;--danger:#ff6369;--ok:#4cc38a;--code:#26262b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
header a{color:var(--fg);text-decoration:none;font-weight:700;font-size:20px}
h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 16px}
.muted{color:var(--muted);font-size:14px}
label{display:block;font-weight:600;margin:12px 0 4px;font-size:14px}
input,textarea,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:110px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
button,.btn{display:inline-block;padding:10px 16px;border-radius:10px;border:0;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary,.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}
button.danger{background:transparent;color:var(--danger);border:1px solid var(--line);padding:6px 10px;font-size:14px}
button.small{padding:6px 10px;font-size:14px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
ul.list{list-style:none;margin:0;padding:0}ul.list li{padding:10px 0;border-top:1px solid var(--line)}ul.list li:first-child{border-top:0}
pre{background:var(--code);border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:13px;margin:6px 0}
code{font-family:ui-monospace,Menlo,monospace}
.flash{border-radius:10px;padding:10px 12px;margin-bottom:16px;border:1px solid var(--line)}
.flash.error{border-color:var(--danger);color:var(--danger)}.flash.ok{border-color:var(--ok);color:var(--ok)}
.qr{background:#fff;padding:12px;border-radius:12px;width:260px;max-width:100%}
.code{font:700 28px ui-monospace,Menlo,monospace;letter-spacing:4px}
.pill{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.err{color:var(--danger);border-color:var(--danger)}
details summary{cursor:pointer;font-weight:600}
nav.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}nav.tabs a{padding:6px 12px;border-radius:99px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-size:14px}
`;

const JS = `
document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;
const t=document.getElementById(b.dataset.copy);await navigator.clipboard.writeText(t.innerText);const o=b.innerText;b.innerText='Copied';setTimeout(()=>b.innerText=o,1500)});
`;

export function Layout(props: { title: string; children?: Child; nav?: boolean; serverName: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{`${props.title} · Tickler`}</title>
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <main>
          <header>
            <a href="/setup">Tickler</a>
            <span class="muted">{props.serverName}</span>
          </header>
          {props.nav ? (
            <nav class="tabs">
              <a href="/setup">Overview</a>
              <a href="/setup/pair">Pair a phone</a>
              <a href="/setup/connect">AI tools</a>
              <a href="/setup/money">Money</a>
              <a href="/setup/security">Security</a>
            </nav>
          ) : null}
          {props.children}
        </main>
        <script>{raw(JS)}</script>
      </body>
    </html>
  );
}

export function Flash(props: { error?: string | null; ok?: string | null }) {
  if (props.error) return <div class="flash error">{props.error}</div>;
  if (props.ok) return <div class="flash ok">{props.ok}</div>;
  return null;
}

let n = 0;
export function Copy(props: { text: string; label?: string }) {
  const id = `copy-${++n}-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div>
      <pre id={id}>{props.text}</pre>
      <button class="small secondary" type="button" data-copy={id}>
        {props.label ?? "Copy"}
      </button>
    </div>
  );
}

/** Small form that POSTs to `action` with one button. */
export function PostButton(props: { action: string; label: string; danger?: boolean; confirm?: string }) {
  return (
    <form method="post" action={props.action} style="display:inline" onsubmit={props.confirm ? `return confirm(${JSON.stringify(props.confirm)})` : undefined}>
      <button class={props.danger ? "danger" : "small secondary"} type="submit">
        {props.label}
      </button>
    </form>
  );
}
