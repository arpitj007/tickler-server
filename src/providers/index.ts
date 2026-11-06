// Registry of money providers and store webhook handlers. The core mounts each webhook at
// POST /hooks/<store> and runs provider.sync on its schedule (provider.syncEveryMinutes).

import { amazonAppstore, amazonWebhook } from "./amazon_appstore";
import { anthropic } from "./anthropic";
import { appStore, appStoreWebhook } from "./app_store";
import { aws } from "./aws";
import { cloudflare } from "./cloudflare";
import { github } from "./github";
import { googleCloud } from "./google_cloud";
import { googlePlay, googlePlayWebhook } from "./google_play";
import { manual } from "./manual";
import { openai } from "./openai";
import { stripe, stripeWebhook } from "./stripe";
import type { Provider, ProviderId, WebhookHandler } from "./types";

export type * from "./types";

export const providers: Provider[] = [
  appStore,
  anthropic,
  cloudflare,
  stripe,
  googlePlay,
  amazonAppstore,
  aws,
  googleCloud,
  openai,
  github,
  manual,
];

export const webhookHandlers: WebhookHandler[] = [appStoreWebhook, googlePlayWebhook, amazonWebhook, stripeWebhook];

export function getProvider(id: string): Provider | undefined {
  return providers.find((p) => p.id === (id as ProviderId));
}

export function getWebhookHandler(store: string): WebhookHandler | undefined {
  return webhookHandlers.find((h) => h.store === store);
}
