import type { IngestResult, PlannedScene, Scene, Script, ScriptLanguage, VideoFormatId } from "@vaani/shared";
import { DEFAULT_SCRIPT_LANGUAGE, DEFAULT_VIDEO_THEME } from "@vaani/shared";
import * as api from "@/lib/api";

export type GenerateProgress =
  | { phase: "plan" }
  | { phase: "write"; done: number; total: number };

const PARALLEL_SCENES = 3;
const SCENE_ATTEMPTS = 2;

async function writeWithRetry(
  params: { ingest: IngestResult; format: VideoFormatId; language: ScriptLanguage; userContext: string; outline: PlannedScene[]; index: number },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < SCENE_ATTEMPTS; attempt++) {
    try {
      return await api.writeScene(params);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Couldn't write a scene");
}

// Plans the video, then writes its scenes a few at a time, reporting progress
// as each one finishes. One failed scene is retried on its own instead of
// throwing away the whole script.
export async function generateInSteps(
  ingest: IngestResult,
  userContext: string,
  format: VideoFormatId,
  options: api.GenerateOptions,
  onProgress: (progress: GenerateProgress) => void,
): Promise<Script> {
  const language = options.language ?? DEFAULT_SCRIPT_LANGUAGE;
  onProgress({ phase: "plan" });
  const outline = await api.planScript(ingest, userContext, format, options);

  let done = 0;
  onProgress({ phase: "write", done, total: outline.length });
  const written = new Array<Awaited<ReturnType<typeof writeWithRetry>>>(outline.length);
  let next = 0;
  async function worker() {
    while (next < outline.length) {
      const index = next++;
      written[index] = await writeWithRetry({ ingest, format, language, userContext, outline, index });
      done += 1;
      onProgress({ phase: "write", done, total: outline.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_SCENES, outline.length) }, worker));

  let beatNumber = 0;
  const scenes: Scene[] = written.map((scene, i) => ({
    id: `scene-${i + 1}`,
    title: scene.title,
    beats: scene.beats.map((beat) => ({ ...beat, id: `beat-${++beatNumber}` })),
  }));
  return {
    repo_url: ingest.repo_url,
    user_context: userContext,
    format,
    language,
    theme: options.theme ?? DEFAULT_VIDEO_THEME,
    recording_mode: options.recordingMode ?? "scenes",
    scenes,
  };
}
