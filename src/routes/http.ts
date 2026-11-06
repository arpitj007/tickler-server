// Shared Hono types and helpers.
import type { Context } from "hono";
import { z } from "zod";
import type { Principal } from "../core/auth";
import type { Ctx } from "../core/context";
import { ApiError } from "../core/util";

export type Env = {
  Variables: {
    ctx: Ctx;
    principal: Principal;
    baseUrl: string;
    ip: string;
  };
};
export type C = Context<Env>;

export function zodFields(e: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
  return fields;
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = zodFields(r.error);
    throw new ApiError(422, "validation_failed", "Some fields are invalid: " + Object.keys(fields).join(", "), { fields });
  }
  return r.data;
}

export async function jsonBody<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  let data: unknown;
  try {
    const text = await c.req.text();
    data = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "bad_request", "Body must be JSON");
  }
  return parse(schema, data);
}

export function errorResponse(e: ApiError) {
  return { error: { code: e.code, message: e.message, ...e.extra } };
}

/** Client IP for rate limits, set once per request by the app (runtime specific, see AppDeps.getIp). */
export function clientIp(c: C): string {
  return c.get("ip") ?? "unknown";
}

export function intParam(v: string | undefined, def: number, max: number): number {
  const n = v === undefined ? def : Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}
