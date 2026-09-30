const CANDIDATE_MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

// The best webm variant this browser can record.
export function pickSupportedMimeType(): string {
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm";
}

const CANDIDATE_AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"];

// The small mic-only companion recording made alongside a continuous take
// (see transcribeSourceKey in shared/): Groq's Whisper API caps uploads well
// under what an 8 to 10 minute webcam video weighs, so transcription reads
// this instead of the full video.
export function pickSupportedAudioMimeType(): string {
  for (const type of CANDIDATE_AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}
