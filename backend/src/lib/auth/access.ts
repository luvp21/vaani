import { hasLimits, PAUSED_MESSAGE } from "@vaani/shared";
import { getLockedScript } from "../lockScript.js";
import { HttpError } from "./http.js";
import { verifyIdToken, type Auth } from "./verify.js";
import { consume, pausedFor, refund, type QuotaKind } from "./quota.js";
import { enforceDailyRenderCap, enforceRate } from "./rateLimit.js";

export { HttpError };
export type { Auth };

// Reads "Authorization: Bearer <Cognito ID token>" and verifies it. Anything else is a 401.
export async function authenticate(authorization: string | undefined): Promise<Auth> {
  const token = /^Bearer (.+)$/i.exec(authorization ?? "")?.[1];
  const auth = token ? await verifyIdToken(token) : null;
  if (!auth) throw new HttpError(401, "Please sign in again.");
  return auth;
}

export function requireJudge(auth: Auth): void {
  if (auth.role !== "judge") throw new HttpError(403, "This is only available to the judge account.");
}

// A tester can only touch projects they made; the judge can touch all of them.
// Projects from before accounts existed have no owner, so only the judge sees them.
export function canAccess(auth: Auth, owner: string | undefined): boolean {
  return auth.role === "judge" || owner === auth.username;
}

async function authorizeScript(auth: Auth, scriptId: string): Promise<void> {
  if (auth.role === "judge") return;
  const locked = await getLockedScript(scriptId).catch(() => null);
  // Same answer for "doesn't exist" and "isn't yours", so ids can't be probed.
  if (!locked || !canAccess(auth, locked.owner)) throw new HttpError(404, "Project not found.");
}

// An extra rule for a route, run after sign-in and ownership but BEFORE any quota
// is spent, so a request refused here costs the caller nothing.
export type Check = (auth: Auth, ctx: { body?: unknown; scriptId?: string }) => Promise<void>;

export interface Guard {
  // Where to find the project id this call acts on, if any.
  script?: "body" | "path";
  // A quota to spend for this call (refunded if it fails on our side).
  quota?: QuotaKind;
  // Routes that spend money (models, transcription, voices, Fargate) get the strict per-minute limit.
  heavy?: boolean;
  check?: Check;
}

// The one place every route (Lambda and local server) checks access: sign-in,
// then project ownership, then quota. Returns who is calling, plus a function
// to give the quota back if the work then fails.
export async function guard(
  authorization: string | undefined,
  rules: Guard,
  ids: { body?: unknown; path?: Record<string, string | undefined> },
): Promise<{ auth: Auth; refundQuota: () => Promise<void> }> {
  const auth = await authenticate(authorization);
  await enforceRate(auth.username, rules.heavy ? "heavy" : "normal", auth.role);
  if (pausedFor(auth.role, rules.heavy)) throw new HttpError(403, PAUSED_MESSAGE);
  let scriptId: string | undefined;
  if (rules.script) {
    const found =
      rules.script === "path" ? ids.path?.scriptId : (ids.body as { script_id?: unknown } | undefined)?.script_id;
    if (typeof found !== "string" || !found) throw new HttpError(400, "script_id is required.");
    scriptId = found;
    await authorizeScript(auth, scriptId);
  }
  if (rules.check) await rules.check(auth, { body: ids.body, scriptId });
  if (rules.quota === "renders" && hasLimits(auth.role)) await enforceDailyRenderCap();
  if (rules.quota) {
    const spent = await consume(auth.username, auth.role, rules.quota);
    if (!spent.ok) throw new HttpError(403, spent.message);
  }
  const kind = rules.quota;
  return { auth, refundQuota: async () => (kind ? refund(auth.username, auth.role, kind) : undefined) };
}
