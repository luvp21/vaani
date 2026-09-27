import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  GoogleSignInRequestSchema,
  hasLimits,
  JudgeLinkRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  type AuthConfig,
  type LoginResponse,
  type RefreshResponse,
  type Session,
} from "@vaani/shared";
import { ZodError } from "zod";
import { authenticate, HttpError } from "../lib/auth/access.js";
import { googleSignIn, judgeSignIn, passwordSignIn, refreshSession, type Tokens } from "../lib/auth/cognito.js";
import { enforceRate } from "../lib/auth/rateLimit.js";
import { checkJudgeLinkKey } from "../lib/auth/judgeLink.js";
import { activeLimits, getUsage } from "../lib/auth/quota.js";
import { sessionExpiry, verifyIdToken, type Auth } from "../lib/auth/verify.js";
import { errorResponse } from "./secure.js";

// Slows guessing on top of the API's rate limit and Cognito's own lockout.
const FAILED_ATTEMPT_DELAY_MS = 500;

async function sessionFor(auth: Auth): Promise<Session> {
  return hasLimits(auth.role)
    ? { username: auth.username, display_name: auth.name, role: auth.role, usage: await getUsage(auth.username), limits: activeLimits() }
    : { username: auth.username, display_name: auth.name, role: auth.role };
}

// Turns Cognito's tokens into what the app stores: who signed in, and the tokens.
async function startSession(tokens: Tokens): Promise<LoginResponse> {
  const auth = await verifyIdToken(tokens.idToken);
  if (!auth) throw new HttpError(401, "This account isn't set up for Vaani.");
  if (!tokens.refreshToken) throw new Error("Cognito returned no refresh token");
  return {
    ...(await sessionFor(auth)),
    token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_at: sessionExpiry(tokens.idToken),
  };
}

async function refuse(message: string): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, FAILED_ATTEMPT_DELAY_MS));
  throw new HttpError(401, message);
}

export async function login(body: unknown, ip = "unknown"): Promise<LoginResponse> {
  await enforceRate(ip, "login");
  const parsed = LoginRequestSchema.parse(body);
  try {
    return await startSession(await passwordSignIn(parsed.username, parsed.password));
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return refuse(err.message);
    throw err;
  }
}

// Opening the private judge link. The key is checked here, before Cognito is
// involved, so a wrong key can never touch (or lock) the judge account.
export async function judgeLink(body: unknown, ip = "unknown"): Promise<LoginResponse> {
  await enforceRate(ip, "login");
  const parsed = JudgeLinkRequestSchema.safeParse(body);
  if (!parsed.success || !checkJudgeLinkKey(parsed.data.key)) return refuse("This link isn't valid.");
  return startSession(await judgeSignIn());
}

// Coming back from Google via Cognito's hosted page.
export async function google(body: unknown, ip = "unknown"): Promise<LoginResponse> {
  await enforceRate(ip, "login");
  const parsed = GoogleSignInRequestSchema.parse(body);
  return startSession(await googleSignIn(parsed.code, parsed.code_verifier, parsed.redirect_uri));
}

// Whether Google sign-in is switched on (it needs credentials from Google Cloud), and where to send people.
export function authConfig(): AuthConfig {
  const domain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.WEB_CLIENT_ID;
  return { google: domain && clientId ? { authorize_url: `https://${domain}/oauth2/authorize`, client_id: clientId } : null };
}

export async function refresh(body: unknown): Promise<RefreshResponse> {
  const parsed = RefreshRequestSchema.parse(body);
  const tokens = await refreshSession(parsed.role, parsed.refresh_token);
  return { token: tokens.idToken, expires_at: sessionExpiry(tokens.idToken) };
}

export async function me(authorization: string | undefined): Promise<Session> {
  return sessionFor(await authenticate(authorization));
}

function fail(err: unknown): APIGatewayProxyStructuredResultV2 {
  if (err instanceof HttpError) return errorResponse(err);
  if (err instanceof ZodError) return { statusCode: 400, body: JSON.stringify({ error: "Enter a username and password." }) };
  return { statusCode: 500, body: JSON.stringify({ error: (err as Error).message }) };
}

// One function for the auth routes: POST /api/auth/login, /judge-link, /google and /refresh; GET /api/auth/me and /config.
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    if (event.rawPath.endsWith("/auth/login")) return { statusCode: 200, body: JSON.stringify(await login(body, event.requestContext?.http?.sourceIp)) };
    if (event.rawPath.endsWith("/auth/judge-link")) return { statusCode: 200, body: JSON.stringify(await judgeLink(body, event.requestContext?.http?.sourceIp)) };
    if (event.rawPath.endsWith("/auth/google")) return { statusCode: 200, body: JSON.stringify(await google(body, event.requestContext?.http?.sourceIp)) };
    if (event.rawPath.endsWith("/auth/config")) return { statusCode: 200, body: JSON.stringify(authConfig()) };
    if (event.rawPath.endsWith("/auth/refresh")) return { statusCode: 200, body: JSON.stringify(await refresh(body)) };
    return { statusCode: 200, body: JSON.stringify(await me(event.headers?.authorization)) };
  } catch (err) {
    return fail(err);
  }
};
