// Shared contract between Track A (script/visual/sync) and Track B (recording/render).
// See docs/ARCHITECTURE.md "Data contracts between stages" — change this file only
// after both tracks agree, per docs/TASK_SPLIT.md.
//
// Schemas are the source of truth; types are inferred from them so the same
// shape is used for both compile-time typing and runtime validation at
// system boundaries (API request bodies, model tool-use output).
import { z } from "zod";
import { VideoFormatIdSchema } from "./formats.js";
import { ScriptLanguageSchema } from "./languages.js";
import { VideoThemeSchema } from "./theme.js";

export * from "./storageKeys.js";
export * from "./formats.js";
export * from "./languages.js";
export * from "./theme.js";
export * from "./auth.js";
export * from "./ingest.js";
export * from "./duration.js";
export * from "./visualDesign.js";

export const VisualTypeSchema = z.enum(["code_highlight", "slide", "ui_demo", "diagram", "chart"]);
export type VisualType = z.infer<typeof VisualTypeSchema>;

export const CodeHighlightSpecSchema = z.object({
  visual_type: z.literal("code_highlight"),
  file_path: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  language: z.string().optional(),
});
export type CodeHighlightSpec = z.infer<typeof CodeHighlightSpecSchema>;

export const SlideSpecSchema = z.object({
  visual_type: z.literal("slide"),
  html: z.string(),
});
export type SlideSpec = z.infer<typeof SlideSpecSchema>;

export const UiDemoSpecSchema = z.object({
  visual_type: z.literal("ui_demo"),
  note: z.string(),
});
export type UiDemoSpec = z.infer<typeof UiDemoSpecSchema>;

// Architecture / flow diagram as data, not HTML: nodes and edges that the
// renderer lays out and animates itself (visualDesign.ts), so diagrams look
// consistent and can't come back broken the way model-written HTML can.
export const DiagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(28),
  detail: z.string().max(34).optional(),
  emphasis: z.boolean().optional(),
});
export const DiagramEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(22).optional(),
});
export const DiagramSpecSchema = z
  .object({
    visual_type: z.literal("diagram"),
    title: z.string().max(60).optional(),
    nodes: z.array(DiagramNodeSchema).min(2).max(8),
    edges: z.array(DiagramEdgeSchema).max(12),
  })
  .refine((d) => d.edges.every((e) => d.nodes.some((n) => n.id === e.from) && d.nodes.some((n) => n.id === e.to)), {
    message: "Every edge must connect two existing node ids",
  });
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

// A bar chart. `source` is required on purpose: charts may only show numbers
// that appear in the repo/README or that the user supplied, and the video shows
// where they came from. Never invented metrics.
export const ChartSpecSchema = z.object({
  visual_type: z.literal("chart"),
  title: z.string().min(1).max(70),
  unit: z.string().max(24).default(""),
  points: z.array(z.object({ label: z.string().min(1).max(28), value: z.number().finite() })).min(2).max(6),
  source: z.string().min(1).max(80),
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const VisualSpecSchema = z.union([
  CodeHighlightSpecSchema,
  SlideSpecSchema,
  UiDemoSpecSchema,
  DiagramSpecSchema,
  ChartSpecSchema,
]);
export type VisualSpec = z.infer<typeof VisualSpecSchema>;

export const BeatSchema = z.object({
  id: z.string(),
  text: z.string(),
  visual_type: VisualTypeSchema,
  visual_spec: VisualSpecSchema,
});
export type Beat = z.infer<typeof BeatSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  beats: z.array(BeatSchema),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  repo_url: z.string(),
  user_context: z.string(),
  // Which kind of video this is (see formats.ts). Old scripts predate it.
  format: VideoFormatIdSchema.default("code_walkthrough"),
  // Language the narration is written and spoken in. Old scripts are Hinglish.
  language: ScriptLanguageSchema.default("hinglish"),
  // Look of the slides, diagrams and charts. Old scripts predate it and stay dark.
  theme: VideoThemeSchema.default("dark"),
  // "scenes" (default): record each scene as its own take, scene by scene.
  // "continuous": read the whole script in one unbroken take (no scene
  // breaks in the recording), for long-form videos where per-scene cuts
  // would feel choppy. Old scripts predate it and stay "scenes".
  recording_mode: z.enum(["scenes", "continuous"]).default("scenes"),
  scenes: z.array(SceneSchema),
});
export type Script = z.infer<typeof ScriptSchema>;
export type RecordingMode = z.infer<typeof ScriptSchema.shape.recording_mode>;

// Recording -> Transcription
export const TranscriptWordSchema = z.object({
  text: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

// Sync -> Render
export const CheckpointSchema = z.object({
  beat_id: z.string(),
  timestamp_ms: z.number(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const SceneCheckpointsSchema = z.object({
  scene_id: z.string(),
  checkpoints: z.array(CheckpointSchema),
  // Where the last spoken word ends, so a video's real length is known without
  // decoding the recording.
  duration_ms: z.number().optional(),
});
export type SceneCheckpoints = z.infer<typeof SceneCheckpointsSchema>;

// Persisted once every scene's real recording is transcribed and synced —
// render (Fargate) checks for this in S3 to decide real-recording path vs.
// Polly fallback (see CLAUDE.md #1: real voice/face is primary, Polly is
// the safety net).
export const SyncResultSchema = z.object({
  script_id: z.string(),
  scenes: z.array(SceneCheckpointsSchema),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;

export const SyncRequestSchema = z.object({
  script_id: z.string(),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

// AI-narrated fallback path (Polly Kajal voice, see docs/ARCHITECTURE.md
// "Fallback path"). Since we generate the audio ourselves, each beat's exact
// duration is known directly from synthesis — no transcription or
// two-pointer sync needed for this path, unlike the real-recording path.
export const BeatNarrationSchema = z.object({
  beat_id: z.string(),
  offset_ms: z.number(), // start of this beat's audio within the scene's concatenated track
  duration_ms: z.number(),
});
export type BeatNarration = z.infer<typeof BeatNarrationSchema>;

export const SceneNarrationSchema = z.object({
  scene_id: z.string(),
  audio_url: z.string(), // presigned S3 URL to the scene's concatenated mp3
  duration_ms: z.number(),
  beats: z.array(BeatNarrationSchema),
});
export type SceneNarration = z.infer<typeof SceneNarrationSchema>;

export const NarrationResultSchema = z.object({
  script_id: z.string(),
  scenes: z.array(SceneNarrationSchema),
});
export type NarrationResult = z.infer<typeof NarrationResultSchema>;

export const NarrateRequestSchema = z.object({
  script_id: z.string(),
});
export type NarrateRequest = z.infer<typeof NarrateRequestSchema>;

// Repo ingest output (stage 1 -> stage 2 input)
export const IngestedFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type IngestedFile = z.infer<typeof IngestedFileSchema>;

export const IngestResultSchema = z.object({
  repo_url: z.string(),
  readme: z.string().nullable(),
  package_files: z.array(IngestedFileSchema),
  sample_files: z.array(IngestedFileSchema),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

// API request/response schemas (backend boundary validation)
export const IngestRequestSchema = z.object({
  repo_url: z.string().min(1),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const ScriptGenRequestSchema = z.object({
  ingest: IngestResultSchema,
  user_context: z.string().default(""),
  format: VideoFormatIdSchema.default("code_walkthrough"),
  language: ScriptLanguageSchema.default("hinglish"),
  // How long the finished video should be. Sets the narration word budget.
  target_minutes: z.number().min(0.25).max(10).optional(),
  // A script the user already wrote. When present the visuals are built around
  // it and its wording is kept, instead of writing the narration from scratch.
  source_script: z.string().max(12000).optional(),
});
export type ScriptGenRequest = z.infer<typeof ScriptGenRequestSchema>;

// Two-stage script generation: a short planning call returns an outline (one
// entry per scene, with a word budget), then each scene is written by its own
// call that sees the shared repo context plus the whole outline. Small calls,
// per-scene length control and retries, and no cap on how long a video can be.
export const PlannedSceneSchema = z.object({
  title: z.string(),
  // What this scene must cover, including the specific repo facts to use.
  purpose: z.string(),
  target_words: z.number().int().positive(),
  // Set when the user supplied their own script: this scene's slice of it.
  source_text: z.string().optional(),
});
export type PlannedScene = z.infer<typeof PlannedSceneSchema>;

export const ScriptPlanResponseSchema = z.object({ scenes: z.array(PlannedSceneSchema).min(1).max(16) });
export type ScriptPlanResponse = z.infer<typeof ScriptPlanResponseSchema>;

export const WriteSceneRequestSchema = z.object({
  ingest: IngestResultSchema,
  format: VideoFormatIdSchema.default("code_walkthrough"),
  language: ScriptLanguageSchema.default("hinglish"),
  user_context: z.string().default(""),
  outline: z.array(PlannedSceneSchema).min(1).max(16),
  index: z.number().int().min(0),
});
export type WriteSceneRequest = z.infer<typeof WriteSceneRequestSchema>;

// Rebuilding one scene (or one beat) from edited narration: the user changed
// the wording, so the visuals are regenerated to match it. Wording is kept.
export const SceneGenRequestSchema = z.object({
  ingest: IngestResultSchema,
  format: VideoFormatIdSchema.default("code_walkthrough"),
  language: ScriptLanguageSchema.default("hinglish"),
  user_context: z.string().default(""),
  scene_title: z.string().default(""),
  narration: z.string().min(1).max(6000),
  // "beat": exactly one beat (refresh a single visual). "scene": split into beats.
  mode: z.enum(["scene", "beat"]),
});
export type SceneGenRequest = z.infer<typeof SceneGenRequestSchema>;

export const SceneGenResponseSchema = z.object({
  title: z.string(),
  beats: z.array(BeatSchema).min(1),
});
export type SceneGenResponse = z.infer<typeof SceneGenResponseSchema>;

export const LockScriptRequestSchema = z.object({
  script: ScriptSchema,
  // Persisted alongside the script so later server-side stages (render) can
  // source real file content for code_highlight beats — without this it
  // only ever existed in the frontend's browser session.
  ingest: IngestResultSchema,
});
export type LockScriptRequest = z.infer<typeof LockScriptRequestSchema>;

export const LockedScriptSchema = z.object({
  script_id: z.string(),
  script: ScriptSchema,
  ingest: IngestResultSchema,
  locked_at: z.string(),
  // Username of the account that locked it. Older projects have none, so only
  // the judge can see them.
  owner: z.string().optional(),
  // The owner's display name, for the judge's dashboard (a Google account's username is an opaque id).
  owner_name: z.string().optional(),
});
export type LockedScript = z.infer<typeof LockedScriptSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// LLM tool-use output, before beat/scene ids are assigned by our code and
// before it's expanded into the real VisualSpec shape. Kept flat and under 8
// properties on purpose — Gemini's forced function-calling (mode: ANY)
// rejects any object schema with 8+ properties with a bare 400
// INVALID_ARGUMENT, confirmed empirically, independent of property names.
// language is inferred from file_path's extension instead of asked for;
// start_line/end_line are packed into one "line_range" string ("10-25").
export const RawBeatSchema = z.object({
  text: z.string(),
  visual_type: VisualTypeSchema,
  file_path: z.string().optional(),
  line_range: z.string().optional(),
  content: z.string().optional(),
});
export type RawBeat = z.infer<typeof RawBeatSchema>;

export const RawSceneSchema = z.object({
  title: z.string(),
  beats: z.array(RawBeatSchema),
});
export type RawScene = z.infer<typeof RawSceneSchema>;

export const RawScriptOutputSchema = z.object({
  scenes: z.array(RawSceneSchema),
});
export type RawScriptOutput = z.infer<typeof RawScriptOutputSchema>;

// Render stage (stage 8, Fargate — never Lambda, see CLAUDE.md #6). Rendering
// takes real time (screenshotting every beat + ffmpeg encoding), so this is
// async: POST /render kicks off a Fargate task and returns immediately, the
// task writes its own progress here as it runs, and the frontend polls
// GET /render/:script_id/status.
export const RenderStatusValueSchema = z.enum(["pending", "running", "done", "error"]);
export type RenderStatusValue = z.infer<typeof RenderStatusValueSchema>;

export const RenderStatusSchema = z.object({
  script_id: z.string(),
  status: RenderStatusValueSchema,
  video_url: z.string().optional(),
  error: z.string().optional(),
  updated_at: z.string(),
});
export type RenderStatus = z.infer<typeof RenderStatusSchema>;

export const RenderRequestSchema = z.object({
  script_id: z.string(),
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

// Recording (stage 5) — scene-by-scene teleprompter capture, see CLAUDE.md
// #2. A recorded scene can easily exceed Lambda/API Gateway payload limits,
// so the browser uploads the video directly to S3 via a presigned PUT URL
// rather than routing the bytes through a Lambda.
export const RecordingUploadUrlRequestSchema = z.object({
  script_id: z.string(),
  scene_id: z.string(),
  content_type: z.string(),
  // Set for a demo clip (one ui_demo beat's screen recording) instead of the
  // scene's narration take.
  beat_id: z.string().optional(),
  // Set for the small mic-only companion recording made alongside a
  // continuous take, uploaded under its own key so it never collides with
  // the full video recording (see FULL_RECORDING_ID).
  audio_only: z.boolean().optional(),
});
export type RecordingUploadUrlRequest = z.infer<typeof RecordingUploadUrlRequestSchema>;

export const RecordingUploadUrlResponseSchema = z.object({
  upload_url: z.string(),
  key: z.string(),
});
export type RecordingUploadUrlResponse = z.infer<typeof RecordingUploadUrlResponseSchema>;

// Transcription (stage 6). Async like render/narration's status polling
// pattern — a real job takes real time. GET status re-queries the actual
// Transcribe job each time rather than us tracking our own status copy,
// since AWS already persists job state reliably.
export const TranscribeRequestSchema = z.object({
  script_id: z.string(),
  scene_id: z.string(),
});
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;

export const TranscribeStatusValueSchema = z.enum(["in_progress", "completed", "failed"]);
export type TranscribeStatusValue = z.infer<typeof TranscribeStatusValueSchema>;

export const TranscribeStatusSchema = z.object({
  script_id: z.string(),
  scene_id: z.string(),
  status: TranscribeStatusValueSchema,
  words: z.array(TranscriptWordSchema).optional(),
  error: z.string().optional(),
});
export type TranscribeStatus = z.infer<typeof TranscribeStatusSchema>;

// Dashboard (projects list + resume). A "project" is a locked script; its
// status is derived from which downstream artifacts exist in S3, so nothing
// extra has to be persisted or kept in sync by the pipeline stages.
export const ProjectStageSchema = z.enum(["scripted", "recording", "synced", "rendering", "done", "error"]);
export type ProjectStage = z.infer<typeof ProjectStageSchema>;

export const ProjectSummarySchema = z.object({
  script_id: z.string(),
  repo_url: z.string(),
  title: z.string(),
  scene_count: z.number(),
  beat_count: z.number(),
  recorded_scene_ids: z.array(z.string()),
  synced: z.boolean(),
  render_status: RenderStatusValueSchema.nullable(),
  stage: ProjectStageSchema,
  locked_at: z.string(),
  // Who made it. Shown to the judge, who sees every account's projects.
  owner: z.string().optional(),
  owner_name: z.string().optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListSchema = z.object({ projects: z.array(ProjectSummarySchema) });
export type ProjectList = z.infer<typeof ProjectListSchema>;

export const ProjectDetailSchema = z.object({
  locked: LockedScriptSchema,
  summary: ProjectSummarySchema,
  render: RenderStatusSchema.nullable(),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
