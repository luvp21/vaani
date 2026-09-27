import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { activeLimits, consume, memoryStore, pausedFor, refund, getUsage } from "./quota.js";
import { checkJudgeLinkKey, judgeLinkKey } from "./judgeLink.js";
import { authenticate, canAccess, HttpError, requireJudge } from "./access.js";
import { createVerifier, sessionExpiry, verifyIdToken } from "./verify.js";
import { FetchError } from "aws-jwt-verify/error";
import { hasLimits, PAUSED_LIMITS, TESTER_LIMITS } from "@vaani/shared";
import { assertAllowedRedirect, assertPasswordLoginAllowed } from "./cognito.js";
import { authConfig } from "../../handlers/auth.js";

const POOL = "us-east-1_TESTPOOL";
const TESTER_CLIENT = "testerclient123";
const JUDGE_CLIENT = "judgeclient456";
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;

before(() => {
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-hmac-signing";
  process.env.USER_POOL_ID = POOL;
  process.env.TESTER_CLIENT_ID = TESTER_CLIENT;
  process.env.JUDGE_CLIENT_ID = JUDGE_CLIENT;
});

// A real RS256 key pair standing in for the pool's published signing keys.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

function verifier() {
  const v = createVerifier({ userPoolId: POOL, clientIds: [TESTER_CLIENT, JUDGE_CLIENT] });
  v.cacheJwks({ keys: [jwk] } as never);
  return v;
}

const inAnHour = Math.floor(Date.now() / 1000) + 3600;

function idToken(claims: Record<string, unknown> = {}, key = privateKey): string {
  const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const body = encode({
    iss: ISSUER,
    aud: TESTER_CLIENT,
    token_use: "id",
    sub: "abc-123",
    "cognito:username": "tester1",
    "cognito:groups": ["tester"],
    name: "Tester 1",
    iat: Math.floor(Date.now() / 1000),
    exp: inAnHour,
    ...claims,
  });
  return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key).toString("base64url")}`;
}

test("a genuine Cognito ID token verifies into who is calling, with the role from the group", async () => {
  assert.deepEqual(await verifyIdToken(idToken(), verifier()), { username: "tester1", role: "tester", name: "Tester 1" });
  const judge = await verifyIdToken(
    idToken({ aud: JUDGE_CLIENT, "cognito:username": "judge", "cognito:groups": ["judge"], name: "Judge" }),
    verifier(),
  );
  assert.deepEqual(judge, { username: "judge", role: "judge", name: "Judge" });
});

test("tokens that are expired, forged, for another pool or client, or not ID tokens are all rejected", async () => {
  const v = verifier();
  assert.equal(await verifyIdToken(idToken({ exp: Math.floor(Date.now() / 1000) - 60 }), v), null, "expired");
  assert.equal(await verifyIdToken(idToken({}, otherKey), v), null, "signed with a different key");
  assert.equal(await verifyIdToken(idToken({ iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTHER" }), v), null, "another pool");
  assert.equal(await verifyIdToken(idToken({ aud: "someotherclient" }), v), null, "another app client");
  assert.equal(await verifyIdToken(idToken({ token_use: "access" }), v), null, "an access token is not accepted as an ID token");
  const [h, , sig] = idToken().split(".");
  const forged = Buffer.from(JSON.stringify({ iss: ISSUER, aud: TESTER_CLIENT, token_use: "id", "cognito:username": "tester1", "cognito:groups": ["judge"], exp: inAnHour })).toString("base64url");
  assert.equal(await verifyIdToken(`${h}.${forged}.${sig}`, v), null, "changing the group must break the signature");
  for (const junk of ["", "abc", "a.b.c", "."]) assert.equal(await verifyIdToken(junk, v), null, junk);
});

test("a user in neither group gets no access, even with a valid token", async () => {
  assert.equal(await verifyIdToken(idToken({ "cognito:groups": [] }), verifier()), null);
  assert.equal(await verifyIdToken(idToken({ "cognito:groups": undefined }), verifier()), null);
  assert.equal(await verifyIdToken(idToken({ "cognito:groups": ["somebody-else"] }), verifier()), null);
});

test("someone who signed in with Google (no group, a federated identity) is a member", async () => {
  const google = idToken({ "cognito:username": "Google_1234567890", "cognito:groups": undefined, identities: [{ providerName: "Google", userId: "1234567890" }], name: "Ada Lovelace" });
  assert.deepEqual(await verifyIdToken(google, verifier()), { username: "Google_1234567890", role: "member", name: "Ada Lovelace" });
  assert.equal(await verifyIdToken(idToken({ "cognito:groups": undefined, identities: [] }), verifier()), null, "no group and not federated: no access");
  assert.equal((await verifyIdToken(idToken({ identities: [{ providerName: "Google" }], "cognito:groups": ["judge"] }), verifier()))?.role, "judge", "a group wins over being federated");
});

test("Google sign-in may only come back to this site's callback page (or the local dev one)", () => {
  const site = "https://example.execute-api.us-east-1.amazonaws.com";
  assert.doesNotThrow(() => assertAllowedRedirect(`${site}/auth/callback`, site));
  assert.doesNotThrow(() => assertAllowedRedirect("http://localhost:5173/auth/callback", site));
  for (const bad of ["https://evil.example/auth/callback", `${site}/somewhere-else`, `${site}/auth/callback?x=1`, ""]) {
    assert.throws(() => assertAllowedRedirect(bad, site), (e: unknown) => e instanceof HttpError && e.status === 400, bad);
  }
});

test("Google sign-in is reported as off until it has a domain and a client", () => {
  const saved = { d: process.env.COGNITO_DOMAIN, c: process.env.WEB_CLIENT_ID };
  delete process.env.COGNITO_DOMAIN;
  delete process.env.WEB_CLIENT_ID;
  assert.deepEqual(authConfig(), { google: null });
  process.env.COGNITO_DOMAIN = "vaani-1.auth.us-east-1.amazoncognito.com";
  process.env.WEB_CLIENT_ID = "webclient";
  assert.deepEqual(authConfig(), { google: { authorize_url: "https://vaani-1.auth.us-east-1.amazoncognito.com/oauth2/authorize", client_id: "webclient" } });
  if (saved.d) process.env.COGNITO_DOMAIN = saved.d; else delete process.env.COGNITO_DOMAIN;
  if (saved.c) process.env.WEB_CLIENT_ID = saved.c; else delete process.env.WEB_CLIENT_ID;
});

test("a team account is its own role: unlimited like the judge, but not the judge", async () => {
  const team = await verifyIdToken(idToken({ "cognito:username": "tester3", "cognito:groups": ["team"], name: "Tester 3" }), verifier());
  assert.deepEqual(team, { username: "tester3", role: "team", name: "Tester 3" });
  assert.equal((await verifyIdToken(idToken({ "cognito:groups": ["team", "tester"] }), verifier()))?.role, "team", "team beats tester");
  assert.equal((await verifyIdToken(idToken({ "cognito:groups": ["judge", "team"] }), verifier()))?.role, "judge", "judge beats team");
});

test("which roles have limits: testers and members do, team and judge don't", () => {
  assert.deepEqual((["tester", "member", "team", "judge"] as const).map(hasLimits), [true, true, false, false]);
  assert.equal(hasLimits(null), false, "no account (an IP address for sign-in) has no allowance to apply");
});

test("a team account is never counted against an allowance, and never blocked by one", async () => {
  const store = memoryStore();
  for (let i = 0; i < 20; i++) assert.equal((await consume("tester3", "team", "renders", store)).ok, true);
  assert.deepEqual(await getUsage("tester3", store), { drafts: 0, locks: 0, renders: 0 });
});

test("a team account sees only its own projects (not the judge's view)", () => {
  const team = { username: "tester3", role: "team" as const, name: "T" };
  assert.equal(canAccess(team, "tester3"), true);
  assert.equal(canAccess(team, "tester1"), false);
  assert.equal(canAccess(team, undefined), false);
  assert.throws(() => requireJudge(team), (e: unknown) => e instanceof HttpError && e.status === 403);
});

test("failing to fetch the pool's keys is a temporary 503, not 'this token is invalid'", async () => {
  const unreachable = { verify: async () => Promise.reject(new FetchError("https://cognito-idp.example/jwks.json", "Response time-out")) };
  await assert.rejects(
    () => verifyIdToken("any.token.here", unreachable as never),
    (e: unknown) => e instanceof HttpError && e.status === 503 && /temporarily unavailable/.test(e.message),
  );
  const badToken = { verify: async () => Promise.reject(new Error("signature check failed")) };
  assert.equal(await verifyIdToken("any.token.here", badToken as never), null, "a genuinely bad token is still just refused");
});

test("a name is optional: the username is used when the token has none", async () => {
  assert.equal((await verifyIdToken(idToken({ name: undefined }), verifier()))?.name, "tester1");
});

test("the session's expiry is read from the token", () => {
  assert.equal(sessionExpiry(idToken({ exp: 1789900000 })), new Date(1789900000 * 1000).toISOString());
});

test("the judge account can't be used for password sign-in, so guessing can never lock the judge out", () => {
  for (const name of ["judge", "Judge", "  JUDGE "]) {
    assert.throws(() => assertPasswordLoginAllowed(name), (e: unknown) => e instanceof HttpError && e.status === 401, name);
  }
  assert.doesNotThrow(() => assertPasswordLoginAllowed("tester1"));
});

test("authenticate needs a valid Bearer token", async () => {
  for (const bad of [undefined, "", "Bearer", "Token abc", "Bearer nonsense"]) {
    await assert.rejects(() => authenticate(bad), (e: unknown) => e instanceof HttpError && e.status === 401, String(bad));
  }
});

test("a tester gets exactly one render, and a refund gives it back", async () => {
  const store = memoryStore();
  assert.deepEqual(await consume("tester1", "tester", "renders", store), { ok: true });
  const second = await consume("tester1", "tester", "renders", store);
  assert.equal(second.ok, false);
  assert.match((second as { message: string }).message, /already made its one video/);
  await refund("tester1", "tester", "renders", store);
  assert.deepEqual(await consume("tester1", "tester", "renders", store), { ok: true });
});

test("simultaneous requests can't both take the last render", async () => {
  const store = memoryStore();
  const results = await Promise.all(Array.from({ length: 10 }, () => consume("tester1", "tester", "renders", store)));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("drafts and locks have their own limits, accounts are separate, and the judge has none", async () => {
  const store = memoryStore();
  for (let i = 0; i < 5; i++) assert.equal((await consume("tester1", "tester", "drafts", store)).ok, true);
  assert.equal((await consume("tester1", "tester", "drafts", store)).ok, false);
  assert.equal((await consume("tester1", "tester", "locks", store)).ok, true, "a spent draft budget doesn't block locking");
  assert.equal((await consume("tester2", "tester", "drafts", store)).ok, true, "one account's use doesn't count against another");
  for (let i = 0; i < 20; i++) assert.equal((await consume("judge", "judge", "renders", store)).ok, true);
  assert.deepEqual(await getUsage("judge", store), { drafts: 0, locks: 0, renders: 0 }, "the judge is never counted");
});

test("while video creation is paused, accounts with limits can do nothing, and the judge and team still can", async () => {
  const before = process.env.VIDEO_CREATION_PAUSED;
  process.env.VIDEO_CREATION_PAUSED = "true";
  try {
    assert.deepEqual(activeLimits(), PAUSED_LIMITS);
    const store = memoryStore();
    for (const kind of ["drafts", "locks", "renders"] as const) {
      // A fresh account has no counter at all, which must not slip through once.
      const refused = await consume("newcomer", "member", kind, store);
      assert.equal(refused.ok, false, `${kind} is refused for a brand-new member`);
      assert.equal((await consume("tester1", "tester", kind, store)).ok, false);
      assert.equal((await consume("tester3", "team", kind, store)).ok, true, "team accounts are unaffected");
      assert.equal((await consume("judge", "judge", kind, store)).ok, true, "the judge is unaffected");
    }
    assert.match((await consume("newcomer", "member", "renders", store) as { message: string }).message, /paused/i);
    // Routes that spend money but carry no quota (write-scene, scene-gen) are closed too.
    assert.equal(pausedFor("tester", true), true);
    assert.equal(pausedFor("member", true), true);
    assert.equal(pausedFor("tester", false), false, "browsing routes stay open");
    assert.equal(pausedFor("team", true), false);
    assert.equal(pausedFor("judge", true), false);
    assert.deepEqual(await getUsage("newcomer", store), { drafts: 0, locks: 0, renders: 0 }, "a refusal counts nothing");
  } finally {
    if (before === undefined) delete process.env.VIDEO_CREATION_PAUSED;
    else process.env.VIDEO_CREATION_PAUSED = before;
  }
  assert.deepEqual(activeLimits(), TESTER_LIMITS, "back to normal once the setting is off");
  assert.equal(pausedFor("tester", true), false, "nothing is refused once the setting is off");
});

test("a refund never goes below zero", async () => {
  const store = memoryStore();
  await refund("tester1", "tester", "drafts", store);
  assert.equal((await getUsage("tester1", store)).drafts, 0);
});

test("a tester can only reach their own projects; the judge reaches all, including ownerless ones", () => {
  const tester = { username: "tester1", role: "tester" as const, name: "T" };
  const judge = { username: "judge", role: "judge" as const, name: "J" };
  assert.equal(canAccess(tester, "tester1"), true);
  assert.equal(canAccess(tester, "tester2"), false);
  assert.equal(canAccess(tester, undefined), false, "older projects have no owner and are the judge's alone");
  assert.equal(canAccess(judge, "tester2"), true);
  assert.equal(canAccess(judge, undefined), true);
  assert.throws(() => requireJudge(tester), (e: unknown) => e instanceof HttpError && e.status === 403);
  assert.doesNotThrow(() => requireJudge(judge));
});

test("the judge link key is long, stable, and only the exact key opens it", () => {
  const key = judgeLinkKey();
  assert.ok(key.length >= 40, "long enough that it can't be guessed");
  assert.equal(key, judgeLinkKey(), "the same secret always gives the same link");
  assert.equal(checkJudgeLinkKey(key), true);
  for (const wrong of ["", "short", key.slice(0, -1), key + "x", key.toUpperCase(), "a".repeat(key.length)]) {
    assert.equal(checkJudgeLinkKey(wrong), false, wrong);
  }
});

test("changing the secret changes the judge link, so the old link stops working", () => {
  const before = judgeLinkKey();
  process.env.AUTH_SECRET = "a-completely-different-secret-of-sufficient-length";
  assert.notEqual(judgeLinkKey(), before);
  assert.equal(checkJudgeLinkKey(before), false);
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-hmac-signing";
});
