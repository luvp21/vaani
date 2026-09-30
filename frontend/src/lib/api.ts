import {
  IngestResultSchema,
  LockedScriptSchema,
  NarrationResultSchema,
  RenderStatusSchema,
  RecordingUploadUrlResponseSchema,
  TranscribeStatusSchema,
  SyncResultSchema,
  ProjectListSchema,
  ProjectDetailSchema,
  SceneGenResponseSchema,
  ScriptPlanResponseSchema,
  ApiErrorSchema,
  LoginResponseSchema,
  RefreshResponseSchema,
  AuthConfigSchema,
  SessionSchema,
  type IngestResult,
  type Script,
  type LockedScript,
  type NarrationResult,
  type RenderStatus,
  type RecordingUploadUrlResponse,
  type TranscribeStatus,
  type SyncResult,
  type ProjectList,
  type ProjectDetail,
  type VideoFormatId,
  type LoginResponse,
  type RefreshResponse,
  type AuthRole,
  type AuthConfig,
  type Session,
  type ScriptLanguage,
  type VideoTheme,
  type RecordingMode,
  type SceneGenResponse,
  type PlannedScene,
} from "@vaani/shared";
import { z } from "zod";

// The signed-in account's token, set by AuthProvider. Sent on every call.
let token: string | null = null;
export function setToken(next: string | null): void {
  token = next;
}

// Fired when the server says the sign-in is no longer good, so the app can
// return to the sign-in page from wherever it is.
export const UNAUTHORIZED_EVENT = "vaani:unauthorized";

// Set by AuthProvider: gets a new ID token from the refresh token (they last an
// hour), or null if the sign-in can't be renewed.
let refreshHandler: (() => Promise<string | null>) | null = null;
export function setRefreshHandler(handler: (() => Promise<string | null>) | null): void {
  refreshHandler = handler;
}

const AUTH_PATHS_WITHOUT_RETRY = new Set(["/auth/login", "/auth/judge-link", "/auth/refresh"]);

// One request, and if the server says the token has expired, one retry with a
// renewed token. Only a failed renewal signs the person out.
async function send(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, { ...init, headers: { ...init.headers, ...authHeaders() } });
  if (res.status !== 401 || !refreshHandler || AUTH_PATHS_WITHOUT_RETRY.has(path)) return res;
  const fresh = await refreshHandler();
  if (!fresh) return res;
  return fetch(`/api${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${fresh}` } });
}

function authHeaders(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function failFrom(res: Response, json: unknown, path: string): Promise<never> {
  if (res.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  const parsedError = ApiErrorSchema.safeParse(json);
  throw new Error(parsedError.success ? parsedError.data.error : `Request to ${path} failed (${res.status})`);
}

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const res = await send(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json();
  if (!res.ok) return failFrom(res, json, path);
  return schema.parse(json);
}

async function getJson<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const res = await send(path, {});
  const json: unknown = await res.json();
  if (!res.ok) return failFrom(res, json, path);
  return schema.parse(json);
}

export function ingestRepo(repoUrl: string): Promise<IngestResult> {
  return postJson("/ingest", { repo_url: repoUrl }, IngestResultSchema);
}

export interface GenerateOptions {
  language?: ScriptLanguage;
  theme?: VideoTheme;
  targetMinutes?: number;
  sourceScript?: string;
  recordingMode?: RecordingMode;
}

// Step 1: the outline only (one entry per scene, with a word budget).
export function planScript(
  ingest: IngestResult,
  userContext: string,
  format: VideoFormatId,
  options: GenerateOptions = {},
): Promise<PlannedScene[]> {
  return postJson(
    "/script/plan",
    { ingest, user_context: userContext, format, language: options.language, target_minutes: options.targetMinutes, source_script: options.sourceScript },
    ScriptPlanResponseSchema,
  ).then((r) => r.scenes);
}

// Step 2: write one scene of that outline.
export function writeScene(params: {
  ingest: IngestResult;
  format: VideoFormatId;
  language?: ScriptLanguage;
  userContext: string;
  outline: PlannedScene[];
  index: number;
}): Promise<SceneGenResponse> {
  return postJson(
    "/script/write-scene",
    { ingest: params.ingest, format: params.format, language: params.language, user_context: params.userContext, outline: params.outline, index: params.index },
    SceneGenResponseSchema,
  );
}

// Rebuilds one scene (or a single beat) from narration the user edited; the
// wording is kept and the visuals are regenerated to match it.
export function regenerateScene(params: {
  ingest: IngestResult;
  format: VideoFormatId;
  language?: ScriptLanguage;
  userContext: string;
  sceneTitle: string;
  narration: string;
  mode: "scene" | "beat";
}): Promise<SceneGenResponse> {
  return postJson(
    "/script/scene",
    {
      ingest: params.ingest,
      format: params.format,
      language: params.language,
      user_context: params.userContext,
      scene_title: params.sceneTitle,
      narration: params.narration,
      mode: params.mode,
    },
    SceneGenResponseSchema,
  );
}

export function lockScript(script: Script, ingest: IngestResult): Promise<LockedScript> {
  return postJson("/script/lock", { script, ingest }, LockedScriptSchema);
}

export function narrateScript(scriptId: string): Promise<NarrationResult> {
  return postJson("/narrate", { script_id: scriptId }, NarrationResultSchema);
}

export function triggerRender(scriptId: string): Promise<RenderStatus> {
  return postJson("/render", { script_id: scriptId }, RenderStatusSchema);
}

export function getRenderStatus(scriptId: string): Promise<RenderStatus> {
  return getJson(`/render/${scriptId}/status`, RenderStatusSchema);
}

export function getRecordingUploadUrl(
  scriptId: string,
  sceneId: string,
  contentType: string,
  options: { beatId?: string; audioOnly?: boolean } = {},
): Promise<RecordingUploadUrlResponse> {
  return postJson(
    "/recording/upload-url",
    { script_id: scriptId, scene_id: sceneId, content_type: contentType, beat_id: options.beatId, audio_only: options.audioOnly },
    RecordingUploadUrlResponseSchema,
  );
}

// Direct-to-S3 upload via presigned URL — never routes the recorded bytes
// through our own API (a multi-minute scene recording could easily exceed
// Lambda/API Gateway payload limits).
export async function uploadRecording(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": blob.type },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Recording upload failed (${res.status})`);
  }
}

export function startTranscription(scriptId: string, sceneId: string): Promise<TranscribeStatus> {
  return postJson("/transcribe", { script_id: scriptId, scene_id: sceneId }, TranscribeStatusSchema);
}

export function getTranscriptionStatus(scriptId: string, sceneId: string): Promise<TranscribeStatus> {
  return getJson(`/transcribe/${scriptId}/${sceneId}/status`, TranscribeStatusSchema);
}

// Computes real-recording checkpoints from every scene's completed
// transcript and persists them — this is what flips the render step from
// the Polly fallback over to the real recorded voice/face (CLAUDE.md #1).
// Fails with a clear error if any scene isn't transcribed yet.
export function syncRecordings(scriptId: string): Promise<SyncResult> {
  return postJson("/sync", { script_id: scriptId }, SyncResultSchema);
}

export function listProjects(): Promise<ProjectList> {
  return getJson("/projects", ProjectListSchema);
}

// Everything needed to reopen a project: the locked script + ingest, which
// scenes already have recordings, whether it's synced, and render status.
export function getProject(scriptId: string): Promise<ProjectDetail> {
  return getJson(`/projects/${scriptId}`, ProjectDetailSchema);
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return postJson("/auth/login", { username, password }, LoginResponseSchema);
}

// Who is signed in and how much of their allowance is used.
export function me(): Promise<Session> {
  return getJson("/auth/me", SessionSchema);
}

// Opening the private judge link exchanges its key for a judge session.
export function judgeLink(key: string): Promise<LoginResponse> {
  return postJson("/auth/judge-link", { key }, LoginResponseSchema);
}

// A new ID token without signing in again.
export function refreshSession(refreshToken: string, role: AuthRole): Promise<RefreshResponse> {
  return postJson("/auth/refresh", { refresh_token: refreshToken, role }, RefreshResponseSchema);
}

// Whether "Continue with Google" is switched on, and where it starts.
export function authConfig(): Promise<AuthConfig> {
  return getJson("/auth/config", AuthConfigSchema);
}

// The second half of "Continue with Google": swap the code Google's page came back with for a session.
export function googleSignIn(code: string, codeVerifier: string, redirectUri: string): Promise<LoginResponse> {
  return postJson("/auth/google", { code, code_verifier: codeVerifier, redirect_uri: redirectUri }, LoginResponseSchema);
}
