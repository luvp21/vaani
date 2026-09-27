import { z } from "zod";

// Who is signed in. A tester is a shared demo account and a member is someone who signed in
// with Google; both make one video of at most 3 minutes. A team account is for us to test with:
// no allowance and no length limit, but it sees only its own projects. The judge sees every
// project from every account, with no limits.
export const AuthRoleSchema = z.enum(["tester", "member", "team", "judge"]);
export type AuthRole = z.infer<typeof AuthRoleSchema>;

// Whether the one-video allowance, the 3 minute cap and the daily render cap apply.
export function hasLimits(role: AuthRole | null): boolean {
  return role === "tester" || role === "member";
}

export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UsageSchema = z.object({
  drafts: z.number().int().nonnegative(),
  locks: z.number().int().nonnegative(),
  renders: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

// What a tester may do in total. Rendering is the expensive step (Fargate), so
// it is strict; drafts and locks only bound the model spend.
export type Limits = Usage;

export const SessionSchema = z.object({
  username: z.string(),
  display_name: z.string(),
  role: AuthRoleSchema,
  // Present for testers; a judge has no limits.
  usage: UsageSchema.optional(),
  limits: UsageSchema.optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// `token` is Cognito's ID token, sent as "Authorization: Bearer" on every call. It
// lasts an hour; `refresh_token` gets a new one without signing in again.
export const LoginResponseSchema = SessionSchema.extend({
  token: z.string(),
  refresh_token: z.string(),
  expires_at: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TESTER_LIMITS: Limits = { drafts: 5, locks: 3, renders: 1 };

// While video creation is paused (for example during judging), no account that has
// limits may draft, lock or render. The judge and team accounts have no limits, so
// they are not affected. Switched on by the VIDEO_CREATION_PAUSED setting.
export const PAUSED_LIMITS: Limits = { drafts: 0, locks: 0, renders: 0 };
export const PAUSED_MESSAGE = "New videos are paused while the hackathon is being judged. You can still sign in and look around.";

// The private judge link carries a long key; opening it signs the judge in.
export const JudgeLinkRequestSchema = z.object({
  key: z.string().min(20).max(200),
});
export type JudgeLinkRequest = z.infer<typeof JudgeLinkRequestSchema>;

export const RefreshRequestSchema = z.object({
  refresh_token: z.string().min(20),
  role: AuthRoleSchema,
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// Every account except the judge makes one video of at most this length.
export const MAX_VIDEO_MINUTES = 3;

// Sign in with Google goes through Cognito's hosted page; when it comes back with a
// code, our API exchanges it (with the PKCE verifier) for the person's session.
export const GoogleSignInRequestSchema = z.object({
  code: z.string().min(10).max(2000),
  code_verifier: z.string().min(43).max(128),
  redirect_uri: z.string().url().max(500),
});
export type GoogleSignInRequest = z.infer<typeof GoogleSignInRequestSchema>;

// What the sign-in page needs to know: whether Google sign-in is switched on, and where to send people.
export const AuthConfigSchema = z.object({
  google: z.object({ authorize_url: z.string(), client_id: z.string() }).nullable(),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
