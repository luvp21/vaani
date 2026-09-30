import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  lockedScriptKey,
  narrationResultKey,
  sceneAudioKey,
  syncResultKey,
  renderStatusKey,
  renderVideoKey,
  type LockedScript,
  type NarrationResult,
  type RenderStatus,
  type SyncResult,
} from "@vaani/shared";
import { getJson, putJson, downloadToFile, putFile } from "./s3.js";
import { beatVisualHtml, chromeFor } from "./visuals.js";
import { closeBrowser } from "./screenshot.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assembleScene, frameCounts, renderBeatClip } from "./beatClip.js";
import { renderContinuousRecording, renderSceneFromRecording } from "./realRender.js";

async function setStatus(scriptId: string, status: RenderStatus["status"], error?: string): Promise<void> {
  const body: RenderStatus = { script_id: scriptId, status, error, updated_at: new Date().toISOString() };
  await putJson(renderStatusKey(scriptId), body);
}

// AI-narrated fallback path (Polly) — see docs/ARCHITECTURE.md.
// renderSceneFromRecording() in realRender.ts is the real-recording
// equivalent, tried first (see main()). Both build the scene the same way:
// one animated clip per beat (beatClip.ts), then the audio laid underneath.
async function renderSceneFromNarration(
  locked: LockedScript,
  narration: NarrationResult,
  sceneId: string,
  workDir: string,
): Promise<string> {
  const scenes = locked.script.scenes;
  const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
  const scene = scenes[sceneIndex];
  const sceneNarration = narration.scenes.find((s) => s.scene_id === sceneId);
  if (!scene || !sceneNarration) throw new Error(`Scene ${sceneId} missing from script or narration`);

  const audioPath = path.join(workDir, `${sceneId}.mp3`);
  await downloadToFile(sceneAudioKey(locked.script_id, sceneId), audioPath);

  const durations = scene.beats.map((beat) => {
    const beatNarration = sceneNarration.beats.find((b) => b.beat_id === beat.id);
    if (!beatNarration) throw new Error(`Beat ${beat.id} missing from narration`);
    return beatNarration.duration_ms / 1000;
  });
  const frames = frameCounts(durations);

  const clipPaths: string[] = [];
  for (let i = 0; i < scene.beats.length; i++) {
    const beat = scene.beats[i];
    const html = await beatVisualHtml(beat, locked.ingest, chromeFor(scenes, sceneIndex, i, false, locked.script.theme));
    clipPaths.push(await renderBeatClip({ html, frames: frames[i], workDir, id: beat.id }));
  }

  const sceneVideoPath = path.join(workDir, `${sceneId}.mp4`);
  await assembleScene({ clipPaths, audioPath, outPath: sceneVideoPath, workDir, sceneId });
  return sceneVideoPath;
}

// Real-recording path is primary (CLAUDE.md #1); Polly is the fallback
// "if the human-recording pipeline breaks." A completed SyncResult in S3
// (written by backend's POST /sync once every scene is recorded +
// transcribed — see backend/src/lib/sync/computeSync.ts) is the signal that
// real recordings exist and are ready; its absence means fall back to
// narration, exactly the way it worked before this path existed.
async function tryGetSyncResult(scriptId: string): Promise<SyncResult | null> {
  try {
    return await getJson<SyncResult>(syncResultKey(scriptId));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const scriptId = process.env.SCRIPT_ID;
  if (!scriptId) throw new Error("SCRIPT_ID env var is not set");

  await setStatus(scriptId, "running");

  const locked = await getJson<LockedScript>(lockedScriptKey(scriptId));
  const sync = await tryGetSyncResult(scriptId);

  const workDir = await mkdtemp(path.join(tmpdir(), "vaani-render-"));

  const sceneVideoPaths: string[] = [];
  if (sync && locked.script.recording_mode === "continuous") {
    // One recording spans the whole script: renderContinuousRecording()
    // already produces the finished video, so there is exactly one "scene"
    // to hand to the concat step below (a harmless one-file remux).
    sceneVideoPaths.push(await renderContinuousRecording(locked, sync, workDir));
  } else if (sync) {
    for (const scene of locked.script.scenes) {
      const sceneCheckpoints = sync.scenes.find((s) => s.scene_id === scene.id);
      if (!sceneCheckpoints) throw new Error(`Scene ${scene.id} missing from sync result`);
      const sceneVideoPath = await renderSceneFromRecording(locked, sceneCheckpoints, scene.id, workDir);
      sceneVideoPaths.push(sceneVideoPath);
    }
  } else {
    const narration = await getJson<NarrationResult>(narrationResultKey(scriptId));
    for (const scene of locked.script.scenes) {
      const sceneVideoPath = await renderSceneFromNarration(locked, narration, scene.id, workDir);
      sceneVideoPaths.push(sceneVideoPath);
    }
  }

  const scenesListPath = path.join(workDir, "scenes.txt");
  await writeFile(scenesListPath, sceneVideoPaths.map((p) => `file '${p}'`).join("\n"));

  const finalVideoPath = path.join(workDir, "final.mp4");
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", scenesListPath, "-c", "copy", finalVideoPath]);

  await putFile(renderVideoKey(scriptId), finalVideoPath, "video/mp4");
  await setStatus(scriptId, "done");
}

// What the person sees in the app. The full error goes to the logs (and the alert);
// AWS and ffmpeg errors carry role names, account ids and command output that
// don't belong on a web page.
export function publicMessage(err: unknown): string {
  if (!(err instanceof Error)) return "The render failed on our side.";
  const fromAws = "$metadata" in err;
  const fromFfmpeg = err.message.startsWith("ffmpeg") || err.message.startsWith("ffprobe");
  return fromAws || fromFfmpeg ? "The render failed on our side." : err.message.slice(0, 300);
}

main()
  .catch(async (err: unknown) => {
    const scriptId = process.env.SCRIPT_ID;
    console.error("Render failed:", err instanceof Error ? err.message : String(err));
    if (scriptId) await setStatus(scriptId, "error", publicMessage(err));
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
