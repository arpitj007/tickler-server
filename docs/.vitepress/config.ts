import { defineConfig, type DefaultTheme } from 'vitepress'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The one value to change when the domain is decided.
// Override at build time with DOCS_SITE_URL, e.g. on a Cloudflare Pages preview.
export const SITE_URL = (process.env.DOCS_SITE_URL ?? 'https://docs.gettickler.com').replace(/\/$/, '')

const REPO = 'https://github.com/arpitj007/tickler-server'

// What the in-app guides use as placeholders, and what the website shows instead.
// The apps substitute the real values; see reference/guides-format.md.
export const PLACEHOLDERS: Record<string, string> = {
  '{{SERVER_URL}}': 'https://your-server.example.com',
  '{{MCP_TOKEN}}': 'tkm_your_token_here',
}

const here = dirname(fileURLToPath(import.meta.url))
const docsRoot = join(here, '..')

function replacePlaceholders(s: string): string {
  let out = s
  for (const [k, v] of Object.entries(PLACEHOLDERS)) out = out.split(k).join(v)
  return out
}

// Provider guides are written separately (docs/providers/*.md). Build their sidebar from
// whatever exists so the site never links to a page that isn't there yet.
function providerItems(): DefaultTheme.SidebarItem[] {
  const dir = join(docsRoot, 'providers')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md' && f !== 'README.md')
    .sort()
    .map((f) => {
      const slug = f.replace(/\.md$/, '')
      const firstHeading = readFileSync(join(dir, f), 'utf8').match(/^#\s+(.+)$/m)?.[1]
      return { text: firstHeading ?? slug, link: `/guides/providers/${slug}` }
    })
}

export default defineConfig({
  title: 'Tickler',
  description:
    'The calendar your AI agents write to. Self-hosted, private, works with any MCP client.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  sitemap: { hostname: SITE_URL },
  srcExclude: ['**/README.md', 'node_modules/**'],
  // In the apps the provider guides live at guides/providers/ (see tickler-app sync-shared.sh),
  // so the site uses the same path. Then a link like providers/stripe.md works in both places.
  rewrites: {
    'providers/:slug*': 'guides/providers/:slug*',
  },
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', content: '#1c1c1e' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Tickler' }],
  ],
  transformHead({ pageData }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    return [['link', { rel: 'canonical', href: `${SITE_URL}/${path}` }]]
  },
  markdown: {
    config(md) {
      // Inline code is shown literally (no Vue interpolation), so pages can mention
      // `{{SERVER_URL}}` itself. Fenced code blocks already behave this way.
      const inlineCode = md.renderer.rules.code_inline!
      md.renderer.rules.code_inline = (tokens, idx, opts, env, self) => {
        tokens[idx].attrSet('v-pre', '')
        return inlineCode(tokens, idx, opts, env, self)
      }
      // Swap the app placeholders for readable examples everywhere on the website:
      // text, inline code, code blocks and link targets.
      md.core.ruler.push('tickler_placeholders', (state) => {
        // Only the shared guides use placeholders; reference pages talk about them literally.
        const rel: string = (state.env as any)?.relativePath ?? ''
        if (!rel.startsWith('guides/')) return
        const walk = (tokens: any[]) => {
          for (const t of tokens) {
            if (t.content && t.content.includes('{{')) t.content = replacePlaceholders(t.content)
            if (t.attrs) for (const a of t.attrs) if (typeof a[1] === 'string' && a[1].includes('{{')) a[1] = replacePlaceholders(a[1])
            if (t.children) walk(t.children)
          }
        }
        walk(state.tokens)
      })
    },
  },
  themeConfig: {
    logo: { light: '/logo.svg', dark: '/logo-dark.svg', alt: '' },
    siteTitle: 'Tickler',
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Suggest a change to this page',
    },
    footer: {
      message: 'Server released under AGPL-3.0. Your data stays on your server.',
      copyright: 'Tickler',
    },
    outline: { level: [2, 3] },
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Connect AI tools', link: '/connect' },
      { text: 'Money', link: '/guides/money' },
      { text: 'Security', link: '/security' },
      { text: 'Help', link: '/faq' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'What is Tickler', link: '/' },
          { text: 'Quick start', link: '/quick-start' },
        ],
      },
      {
        text: 'Run your server',
        items: [
          { text: 'Deploy on Cloudflare', link: '/guides/deploy-cloudflare' },
          { text: 'Deploy with Docker', link: '/guides/deploy-docker' },
          { text: 'I already have a server', link: '/guides/existing-server' },
          { text: 'Public URL: Cloudflare Tunnel', link: '/guides/public-url-cloudflare-tunnel' },
          { text: 'Public URL: Tailscale Funnel', link: '/guides/public-url-tailscale-funnel' },
          { text: 'Self-hosting FAQ', link: '/self-hosting-faq' },
        ],
      },
      {
        text: 'Pair your phone',
        items: [{ text: 'iPhone and Android', link: '/guides/pair' }],
      },
      {
        text: 'Connect your AI tools',
        items: [
          { text: 'Overview', link: '/connect' },
          { text: 'Claude Code', link: '/guides/connect/claude-code' },
          { text: 'Claude apps', link: '/guides/connect/claude-apps' },
          { text: 'Cursor', link: '/guides/connect/cursor' },
          { text: 'Codex', link: '/guides/connect/codex' },
          { text: 'ChatGPT', link: '/guides/connect/chatgpt' },
          { text: 'Gemini CLI', link: '/guides/connect/gemini-cli' },
          { text: 'T3 Code and orchestrators', link: '/guides/connect/t3-code' },
          { text: 'Any other MCP client', link: '/guides/connect/other' },
          { text: 'The instruction block', link: '/guides/instruction-block' },
        ],
      },
      {
        text: 'Using Tickler',
        items: [
          { text: 'Origins explained', link: '/origins' },
          { text: 'Notifications', link: '/guides/notifications' },
        ],
      },
      {
        text: 'Money',
        collapsed: false,
        items: [
          { text: 'Money overview', link: '/guides/money' },
          { text: 'Budgets and forecasts', link: '/budgets-and-forecasts' },
          ...(providerItems().length
            ? [{ text: 'Provider guides', collapsed: true, items: providerItems() }]
            : []),
        ],
      },
      {
        text: 'Trust',
        items: [
          { text: 'Security and threat model', link: '/security' },
          { text: 'Privacy policy', link: '/privacy' },
          { text: 'Terms of use', link: '/terms' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'FAQ', link: '/faq' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'Support', link: '/support' },
        ],
      },
      {
        text: 'Reference',
        collapsed: true,
        items: [
          { text: 'MCP tools', link: '/reference/mcp-tools' },
          { text: 'API contract', link: '/reference/api-contract' },
          { text: 'In-app guide format', link: '/reference/guides-format' },
          { text: 'Hosting these docs', link: '/reference/hosting-docs' },
          { text: 'Sources checked', link: '/reference/sources' },
        ],
      },
    ],
  },
})
