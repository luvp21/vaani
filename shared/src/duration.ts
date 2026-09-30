// How long narration takes to say, so a target video length can be turned into
// a word budget for the script and a script back into an estimated length.
// 135 words per minute is measured, not assumed: Amazon Polly's Kajal read a
// real 26-word Hinglish scene in 11.4s (about 137 wpm), and a person reading
// from a prompter is in the same range.
export const WORDS_PER_MINUTE = 135;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function estimateSeconds(text: string): number {
  return (countWords(text) / WORDS_PER_MINUTE) * 60;
}

export function wordBudget(minutes: number): number {
  return Math.round(minutes * WORDS_PER_MINUTE);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Target lengths offered in the UI, and a sensible default per format. The
// 8/10 options only ever show for accounts with no length limit (see
// hasLimits() in auth.ts and how RepoForm filters this list) — long-form,
// continuous-take videos are the reason they exist.
export const TARGET_MINUTES_OPTIONS = [0.5, 1, 2, 3, 5, 8, 10] as const;
export function minutesLabel(minutes: number): string {
  return minutes < 1 ? `${Math.round(minutes * 60)} sec` : `${minutes} min`;
}

// A demo clip is rarely exactly as long as the narration over it. A shorter
// clip plays at normal speed and holds its last frame. A longer one is sped up
// so the WHOLE clip fits: the end of a clip is usually the result the step is
// about, so it is never cut off. The clip is squeezed into most of the beat
// (RESULT_HOLD_SHARE) so the result stays on screen for the rest of it.
export const RESULT_HOLD_SHARE = 0.85;

// Past this speed the footage stops being readable; the recorder warns the
// presenter to trim or re-record (the render still shows all of it).
export const WARN_CLIP_SPEED = 6;

export function clipSpeed(clipSeconds: number, beatSeconds: number): number {
  if (!(clipSeconds > 0) || !(beatSeconds > 0) || clipSeconds <= beatSeconds) return 1;
  return clipSeconds / (beatSeconds * RESULT_HOLD_SHARE);
}
