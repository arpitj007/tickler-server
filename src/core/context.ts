import type { Storage, Stmt } from "../storage/types";
import type { Provider, WebhookHandler } from "../providers/types";

export interface Config {
  /** TICKLER_SECRET. Null only on a misconfigured Worker; /setup then explains how to set it. */
  secret: string | null;
  serverName: string;
  /** TICKLER_PUBLIC_URL without trailing slash, or null to derive from the request. */
  publicUrl: string | null;
  currency: string;
  /** TICKLER_DEMO_PAIRING_CODE: review/demo servers only. Always accepted, never used up. */
  demoPairingCode: string | null;
}

export interface Ctx {
  storage: Storage;
  config: Config;
  now: () => Date;
  providers: Provider[];
  webhookHandlers: WebhookHandler[];
  fetch: typeof fetch;
}

export type ActorType = "device" | "mcp_token" | "oauth_client" | "admin" | "system";
export interface Actor {
  type: ActorType;
  id: string | null;
  name: string | null;
}
export const SYSTEM: Actor = { type: "system", id: null, name: "Tickler" };

/** Every insert/update of a synced row runs in a batch with BUMP and sets rev = REV. */
export const BUMP: Stmt = { sql: "UPDATE seq SET value = value + 1 WHERE id = 1" };
export const REV = "(SELECT value FROM seq WHERE id = 1)";

export function configFromEnv(env: Record<string, unknown>): Config {
  const str = (k: string) => (typeof env[k] === "string" && (env[k] as string).trim() ? (env[k] as string).trim() : null);
  return {
    secret: str("TICKLER_SECRET"),
    serverName: str("TICKLER_SERVER_NAME") ?? "Tickler",
    publicUrl: str("TICKLER_PUBLIC_URL")?.replace(/\/+$/, "") ?? null,
    currency: (str("TICKLER_CURRENCY") ?? "USD").toUpperCase(),
    demoPairingCode: str("TICKLER_DEMO_PAIRING_CODE")?.toUpperCase().replace(/[\s-]/g, "") ?? null,
  };
}
