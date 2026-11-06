// Manual: numbers you push yourself with POST /api/metrics (a device or tkm_ token), plus fixed
// costs entered in the app. No remote calls.

import type { Provider } from "./types";

export const manual: Provider = {
  id: "manual",
  displayName: "Manual and fixed costs",
  kind: "cost",
  guide: "providers/manual",
  freshness: "when you send it",
  syncEveryMinutes: 24 * 60,
  fields: [],
  configured: () => true,
  test: async () => ({ ok: true, message: "Nothing to connect: send numbers with POST /api/metrics." }),
  sync: async () => ({ snapshots: [] }),
};
