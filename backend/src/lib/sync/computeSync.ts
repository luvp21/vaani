import {
  FULL_RECORDING_ID,
  syncResultKey,
  type Checkpoint,
  type LockedScript,
  type Scene,
  type SceneCheckpoints,
  type SyncResult,
} from "@vaani/shared";
import { getTranscriptionStatus } from "../transcribe/index.js";
import { putJson } from "../s3.js";
import { transliterateTranscript } from "./transliterate.js";
import { syncScene, syncScript } from "./index.js";

// Real-recording path's equivalent of narrateScript() in ../narration —
// turns each scene's completed transcript into checkpoints via the
// two-pointer algorithm, instead of deriving them deterministically from
// synthesized audio. Render (Fargate) treats "a SyncResult exists in S3" as
// its signal to use the real-recording path over the Polly fallback (see
// CLAUDE.md #1).
export async function computeSync(locked: LockedScript): Promise<SyncResult> {
  if (locked.script.recording_mode === "continuous") return computeContinuousSync(locked);

  // "scenes" mode: one recording per scene, transcribed and synced separately
  // — requires every scene's transcription to already be completed (the
  // frontend fires recording+transcription per scene as each one is
  // uploaded — see TeleprompterRecorder.tsx); a scene that isn't ready yet
  // throws rather than silently persisting a partial/wrong result.
  const scenes: SceneCheckpoints[] = [];
  for (const scene of locked.script.scenes) {
    const status = await getTranscriptionStatus(locked.script_id, scene.id);
    if (status.status !== "completed") {
      throw new Error(
        `Scene ${scene.id} isn't transcribed yet (status: ${status.status}) — record and upload every scene before syncing.`,
      );
    }
    const transliterated = transliterateTranscript(status.words ?? []);
    const checkpoints = syncScene(scene, transliterated);
    scenes.push({ scene_id: scene.id, checkpoints, duration_ms: transliterated.at(-1)?.end_ms });
  }

  const result: SyncResult = { script_id: locked.script_id, scenes };
  await putJson(syncResultKey(locked.script_id), result);
  return result;
}

// "continuous" mode: one recording spans every scene's beats back to back
// (see FULL_RECORDING_ID), so there is one transcript to check and one walk
// to run (syncScript, across all scenes in document order), not one per
// scene. The result still comes out shaped as SceneCheckpoints[] — same as
// "scenes" mode — so render and the length checks don't need to know which
// mode produced it: the flat checkpoint list is simply bucketed back into
// its original scenes afterward.
async function computeContinuousSync(locked: LockedScript): Promise<SyncResult> {
  const status = await getTranscriptionStatus(locked.script_id, FULL_RECORDING_ID);
  if (status.status !== "completed") {
    throw new Error(`The full recording isn't transcribed yet (status: ${status.status}) — record and upload it before syncing.`);
  }
  const transliterated = transliterateTranscript(status.words ?? []);
  const flatCheckpoints = syncScript(locked.script.scenes, transliterated);
  const takeEndMs = transliterated.at(-1)?.end_ms ?? 0;

  const scenes = bucketByScene(locked.script.scenes, flatCheckpoints, takeEndMs);
  const result: SyncResult = { script_id: locked.script_id, scenes };
  await putJson(syncResultKey(locked.script_id), result);
  return result;
}

// Splits one flat, in-order checkpoint list (spanning every scene) back into
// one SceneCheckpoints entry per scene. Each scene's duration_ms is the real
// span of time it occupies in the take (its first beat's checkpoint up to
// the next scene's first checkpoint, or the take's end for the last scene),
// so summing every scene's duration_ms still gives the take's true total
// length — the same thing totalSpeechMs() (videoLimit.ts) already does with
// "scenes" mode's per-scene durations.
export function bucketByScene(scenes: Scene[], flatCheckpoints: Checkpoint[], takeEndMs: number): SceneCheckpoints[] {
  const sceneStartMs = scenes.map((scene, index) => {
    if (index === 0) return 0;
    const firstBeatId = scenes[index].beats[0]?.id;
    return flatCheckpoints.find((c) => c.beat_id === firstBeatId)?.timestamp_ms ?? 0;
  });

  let cursor = 0;
  return scenes.map((scene, index) => {
    const checkpoints = flatCheckpoints.slice(cursor, cursor + scene.beats.length);
    cursor += scene.beats.length;
    const endMs = index + 1 < scenes.length ? sceneStartMs[index + 1] : takeEndMs;
    return { scene_id: scene.id, checkpoints, duration_ms: Math.max(0, endMs - sceneStartMs[index]) };
  });
}
