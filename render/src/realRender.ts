import path from "node:path";
import {
  FULL_RECORDING_ID,
  clipKey,
  clipSpeed,
  recordingKey,
  type Beat,
  type Checkpoint,
  type LockedScript,
  type SceneCheckpoints,
} from "@vaani/shared";
import { downloadIfExists, downloadToFile } from "./s3.js";
import { demoFrameHtml } from "@vaani/shared";
import { beatVisualHtml, chromeFor } from "./visuals.js";
import { getMediaDurationMs, hasVideoStream } from "./ffmpeg.js";
import { overlayFace } from "./faceOverlay.js";
import { assembleScene, frameCounts, renderBeatClip, renderFootageClip } from "./beatClip.js";

// Minimum on-screen hold per beat, inspired by /brag's pacing rule ("~0.8s
// for labels holding long enough to absorb") — a real checkpoint gap this
// small only happens when the sync algorithm's stall-skip fires close
// together, and a visual flashing for a handful of frames reads as a glitch,
// not a deliberate cut. This is a floor, not a target: real gaps are
// normally much longer, and `-shortest` (assembleScene) still caps the scene
// to the real recording's audio, so inflating one beat can only ever eat
// into later beats' slack, never desync from the real voice track.
//
// Deliberately NOT /brag's fuller word-count rule (~0.3s per word, min 1.2s
// for full sentences): /brag controls its own timing freely, but this
// video must stay locked to a real human's speech, and 0.3s/word (~3.3
// words/sec) would bind on ordinary fast speakers, inflating a beat and
// pushing every later beat visibly out of sync with the real audio. Only
// genuinely pathological gaps (< 0.8s, almost certainly a sync stall, not
// real speech pacing) should be overridden here.
const MIN_BEAT_HOLD_SECONDS = 0.8;

// One beat, with where it sits in the original script (chromeFor's bottom bar
// wants a real scene index and a real position within that scene, even when
// every beat here has been flattened out of several scenes for a continuous
// take — see renderContinuousRecording).
interface PositionedBeat {
  beat: Beat;
  sceneIndex: number;
  beatIndexInScene: number;
}

// Shared by renderSceneFromRecording (one scene, its own recording) and
// renderContinuousRecording (every scene's beats, one recording spanning all
// of them): builds one animated clip per beat from the real checkpoint gaps,
// lays the recording's real audio underneath, and overlays the presenter's
// face if the recording has a video track. `outId` only names the temp files.
async function renderClipsAgainstRecording(params: {
  locked: LockedScript;
  scenes: { title: string; beats: unknown[] }[];
  beats: PositionedBeat[];
  checkpoints: Checkpoint[];
  recordingPath: string;
  workDir: string;
  outId: string;
}): Promise<string> {
  const { locked, scenes, beats, checkpoints, recordingPath, workDir, outId } = params;
  if (checkpoints.length !== beats.length) {
    throw new Error(`${outId}: expected ${beats.length} checkpoints (one per beat), got ${checkpoints.length}`);
  }
  beats.forEach(({ beat }, index) => {
    if (checkpoints[index].beat_id !== beat.id) {
      throw new Error(`${outId}: checkpoint order doesn't match beat order at index ${index}`);
    }
  });

  const recordingDurationMs = await getMediaDurationMs(recordingPath);
  // The narration take is camera + mic, so it is also where the face comes
  // from. No video track (camera denied, audio-only) just means no bubble.
  const facePath = (await hasVideoStream(recordingPath)) ? recordingPath : null;
  const hasFace = facePath !== null;

  const durations = beats.map((_, i) => {
    // The first beat owns everything before the first spoken word (the
    // silence between pressing record and speaking). Measuring it from its own
    // checkpoint instead drops that lead-in from the video, and since the
    // audio keeps it, every later cut would land early by exactly that long.
    const startMs = i === 0 ? 0 : checkpoints[i].timestamp_ms;
    const endMs = i + 1 < checkpoints.length ? checkpoints[i + 1].timestamp_ms : recordingDurationMs;
    return Math.max(MIN_BEAT_HOLD_SECONDS, Math.max(0, endMs - startMs) / 1000);
  });
  const frames = frameCounts(durations);

  const clipPaths: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const { beat, sceneIndex, beatIndexInScene } = beats[i];
    const chrome = chromeFor(scenes, sceneIndex, beatIndexInScene, hasFace, locked.script.theme);
    if (beat.visual_spec.visual_type === "ui_demo") {
      const footage = await fetchDemoClip(locked.script_id, beat.id, workDir);
      if (footage) {
        // The presenter's own silent screen clip for this step.
        const clipSeconds = (await getMediaDurationMs(footage)) / 1000;
        clipPaths.push(
          await renderFootageClip({
            frameHtml: demoFrameHtml(beat.visual_spec.note || "Live demo", chrome),
            hasFace,
            clipPath: footage,
            speed: clipSpeed(clipSeconds, durations[i]),
            frames: frames[i],
            workDir,
            id: beat.id,
          }),
        );
        continue;
      }
      // No clip was recorded for this step: fall through to the text card
      // saying what the viewer would have seen.
    }
    const html = await beatVisualHtml(beat, locked.ingest, chrome);
    clipPaths.push(await renderBeatClip({ html, frames: frames[i], workDir, id: beat.id }));
  }

  const outPath = path.join(workDir, `${outId}.mp4`);
  if (!facePath) {
    await assembleScene({ clipPaths, audioPath: recordingPath, outPath, workDir, sceneId: outId });
    return outPath;
  }
  const barePath = path.join(workDir, `${outId}-bare.mp4`);
  await assembleScene({ clipPaths, audioPath: recordingPath, outPath: barePath, workDir, sceneId: outId });
  await overlayFace({ scenePath: barePath, facePath, outPath });
  return outPath;
}

// Real-recording render path (CLAUDE.md #1's primary path, not the Polly
// fallback): visuals cut in full-screen at each beat's real sync checkpoint,
// with the scene's actual recorded audio (the presenter's real voice)
// playing throughout, and the presenter's face in a bubble over it (faceOverlay.ts).
// Product-demo beats show the presenter's own silent screen clip for that step,
// recorded separately from the narration so the app can use the mic. Each beat
// is an animated clip (beatClip.ts) so a cut lands as an entrance, not a hard jump.
export async function renderSceneFromRecording(
  locked: LockedScript,
  sceneCheckpoints: SceneCheckpoints,
  sceneId: string,
  workDir: string,
): Promise<string> {
  const scenes = locked.script.scenes;
  const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
  const scene = scenes[sceneIndex];
  if (!scene) throw new Error(`Scene ${sceneId} missing from script`);

  const recordingPath = path.join(workDir, `${sceneId}-recording.webm`);
  await downloadToFile(recordingKey(locked.script_id, sceneId, "webm"), recordingPath);

  return renderClipsAgainstRecording({
    locked,
    scenes,
    beats: scene.beats.map((beat, beatIndexInScene) => ({ beat, sceneIndex, beatIndexInScene })),
    checkpoints: sceneCheckpoints.checkpoints,
    recordingPath,
    workDir,
    outId: sceneId,
  });
}

// Continuous-take render path (recording_mode: "continuous" — see CLAUDE.md's
// recording decision and shared/src/index.ts). One recording spans every
// scene's beats back to back, so there is one audio/video track for the whole
// video, not one per scene: the presenter's face and voice never cut, only the
// background visual changes at each beat's checkpoint, exactly like a single
// very long scene. Produces the final video directly — index.ts's concat step
// then has exactly one file to "join", a harmless no-op remux.
export async function renderContinuousRecording(
  locked: LockedScript,
  syncResult: { scenes: SceneCheckpoints[] },
  workDir: string,
): Promise<string> {
  const scenes = locked.script.scenes;
  const beats: PositionedBeat[] = scenes.flatMap((scene, sceneIndex) =>
    scene.beats.map((beat, beatIndexInScene) => ({ beat, sceneIndex, beatIndexInScene })),
  );
  const checkpoints = syncResult.scenes.flatMap((s) => s.checkpoints);

  const recordingPath = path.join(workDir, `${FULL_RECORDING_ID}-recording.webm`);
  await downloadToFile(recordingKey(locked.script_id, FULL_RECORDING_ID, "webm"), recordingPath);

  return renderClipsAgainstRecording({
    locked,
    scenes,
    beats,
    checkpoints,
    recordingPath,
    workDir,
    outId: FULL_RECORDING_ID,
  });
}

// The step's screen clip, if the presenter recorded one. A skipped step is not
// an error: it renders as a text card.
async function fetchDemoClip(scriptId: string, beatId: string, workDir: string): Promise<string | null> {
  const clipPath = path.join(workDir, `${beatId}-clip.webm`);
  return (await downloadIfExists(clipKey(scriptId, beatId, "webm"), clipPath)) ? clipPath : null;
}
