// S3 key naming conventions shared between backend (writes locked scripts,
// narration) and render (reads them, writes the final video) — these are
// separate codebases/workspaces, so keeping the convention in one place
// avoids a silent key-mismatch typo between them.

export function lockedScriptKey(scriptId: string): string {
  return `scripts/${scriptId}.json`;
}

export function narrationResultKey(scriptId: string): string {
  return `narration/${scriptId}/result.json`;
}

export function sceneAudioKey(scriptId: string, sceneId: string): string {
  return `narration/${scriptId}/${sceneId}.mp3`;
}

export function renderStatusKey(scriptId: string): string {
  return `renders/${scriptId}/status.json`;
}

export function renderVideoKey(scriptId: string): string {
  return `renders/${scriptId}/final.mp4`;
}

export function recordingKey(scriptId: string, sceneId: string, extension: string): string {
  return `recordings/${scriptId}/${sceneId}.${extension}`;
}

// The sentinel "scene id" for a continuous (recording_mode: "continuous")
// take: one recording covering every scene's beats back to back, instead of
// one recording per scene. Every place that is normally keyed per scene
// (recordingKey, transcribeOutputKey, the transcribe status poll) reuses this
// one id for that script instead. Never a real scene id (scene ids come from
// idGenerator() in scriptGen.ts, which never produces this shape).
export const FULL_RECORDING_ID = "__full__";

// Where transcription reads its audio from. A continuous take also uploads a
// small mic-only companion recording (see RecordingUploadUrlRequestSchema's
// audio_only field) purely for this: Groq's Whisper API caps uploads at
// 25 MB (free tier) to 100 MB (paid), and an 8 to 10 minute webcam recording
// is comfortably over that, while the audio-only companion is a few MB. A
// per-scene recording is already short enough to transcribe as-is.
export function transcribeSourceKey(scriptId: string, sceneId: string): string {
  return sceneId === FULL_RECORDING_ID ? recordingKey(scriptId, sceneId, "audio.webm") : recordingKey(scriptId, sceneId, "webm");
}

// A silent screen clip of one product-demo step (one ui_demo beat), recorded on
// its own before the narration. Kept out of recordings/ so it is never mistaken
// for a scene's narration take.
export function clipKey(scriptId: string, beatId: string, extension: string): string {
  return `clips/${scriptId}/${beatId}.${extension}`;
}

export function transcribeOutputKey(scriptId: string, sceneId: string): string {
  return `transcripts/${scriptId}/${sceneId}/output.json`;
}

export function syncResultKey(scriptId: string): string {
  return `sync/${scriptId}/result.json`;
}

