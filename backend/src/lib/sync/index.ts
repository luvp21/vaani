import type { Beat, Checkpoint, Scene, TranscriptWord } from "@vaani/shared";
import { hasWordContent, wordsMatch } from "./matches.js";

// The stall threshold, per docs/SYNC_ALGORITHM.md: "start around 15-20
// transcript words".
const DEFAULT_STALL_THRESHOLD = 18;

interface ScriptWord {
  text: string;
  // Set only on a beat's first word — that's what a "beat boundary" is.
  beatId?: string;
}

function tokenizeBeats(beats: Beat[]): ScriptWord[] {
  const words: ScriptWord[] = [];
  for (const beat of beats) {
    const beatWords = beat.text.split(/\s+/).filter(hasWordContent);
    beatWords.forEach((text, index) => {
      words.push({ text, beatId: index === 0 ? beat.id : undefined });
    });
  }
  return words;
}

// Classifies a mismatch at script[i] / transcript[j] that heals right after:
//  - "substituted": the two script words after i match the two transcript words
//    after j, so the word was misheard (e.g. "Ye" heard as "This"); the
//    transcript word stands in for it and is consumed.
//  - "dropped": script[i+1], script[i+2] match transcript[j], transcript[j+1],
//    so the word wasn't said at all; the transcript word is NOT consumed, it
//    belongs to the next script word.
// Two consecutive matches are required so one coincidental fuzzy match can't
// trigger a skip.
function classifyMismatch(
  script: ScriptWord[],
  transcript: TranscriptWord[],
  i: number,
  j: number,
): "substituted" | "dropped" | null {
  if (i + 2 >= script.length) return null;
  if (
    j + 2 < transcript.length &&
    wordsMatch(script[i + 1].text, transcript[j + 1].text) &&
    wordsMatch(script[i + 2].text, transcript[j + 2].text)
  ) {
    return "substituted";
  }
  if (
    j + 1 < transcript.length &&
    wordsMatch(script[i + 1].text, transcript[j].text) &&
    wordsMatch(script[i + 2].text, transcript[j + 1].text)
  ) {
    return "dropped";
  }
  return null;
}

// The two-pointer walk from docs/SYNC_ALGORITHM.md: the script is
// authoritative, the transcript is allowed to be messy. A transcript word
// that doesn't match only costs the transcript pointer (j) — it's treated
// as a stutter/repeat/filler/mis-hear, and the script pointer (i) never
// advances until its word is actually found.
//
// Stall handling: if j advances stallThreshold words without i moving, the
// script pointer is stuck on a mumbled/missed/mispronounced word. Force i
// forward past it rather than freezing the rest of the walk. If the stuck
// word itself was a beat boundary, it still needs a checkpoint (a checkpoint
// landing a fraction late is invisible in the final video; a beat with no
// checkpoint at all is not) — the docs don't spell out this exact case, so:
// use the current transcript position as the best available approximation.
//
// Shared by syncScene() (one scene's own recording) and syncScript() (one
// continuous take spanning every scene) — everything below cares only about
// a flat list of beats and words, never about scene boundaries, so the same
// walk serves both.
function walk(
  scriptWords: ScriptWord[],
  beatsForFallback: Beat[],
  allTranscriptWords: TranscriptWord[],
  stallThreshold: number,
  label: string,
): Checkpoint[] {
  // Whisper returns punctuation-only tokens (a dash echoed from the prompt);
  // they can't match anything, so drop them before walking.
  const transcriptWords = allTranscriptWords.filter((w) => hasWordContent(w.text));
  const checkpoints: Checkpoint[] = [];
  let i = 0;
  let j = 0;
  let stalledFor = 0;
  let mismatch: ReturnType<typeof classifyMismatch>;

  while (i < scriptWords.length && j < transcriptWords.length) {
    const currentScriptWord = scriptWords[i];
    if (wordsMatch(currentScriptWord.text, transcriptWords[j].text)) {
      if (currentScriptWord.beatId) {
        checkpoints.push({ beat_id: currentScriptWord.beatId, timestamp_ms: transcriptWords[j].start_ms });
      }
      i += 1;
      j += 1;
      stalledFor = 0;
    } else if ((mismatch = classifyMismatch(scriptWords, transcriptWords, i, j))) {
      // One script word was misheard or never said, but the words right after
      // it line up again: skip just that word now instead of waiting out the
      // stall threshold. If it opened a beat, use this transcript word's own
      // time — it is where that word was (mis)heard, or where the next word
      // (the closest thing to it) begins.
      if (currentScriptWord.beatId) {
        checkpoints.push({ beat_id: currentScriptWord.beatId, timestamp_ms: transcriptWords[j].start_ms });
      }
      i += 1;
      if (mismatch === "substituted") j += 1;
      stalledFor = 0;
    } else {
      j += 1;
      stalledFor += 1;
      if (stalledFor >= stallThreshold) {
        console.warn(
          `sync: stalled ${stallThreshold}+ transcript words on script word "${currentScriptWord.text}" (${label}, script index ${i}) — skipping it`,
        );
        if (currentScriptWord.beatId) {
          const fallbackIndex = Math.min(j, transcriptWords.length - 1);
          checkpoints.push({ beat_id: currentScriptWord.beatId, timestamp_ms: transcriptWords[fallbackIndex].start_ms });
        }
        i += 1;
        stalledFor = 0;
      }
    }
  }

  // Safety net: a beat whose script words never matched at all (transcript
  // ran out early, or every one of its words stalled) still needs a
  // checkpoint, or the render step ends up with a missing beat entirely.
  // These are always a contiguous trailing run of beatsForFallback — the walk
  // above only ever moves i forward through script words in beat order, so
  // once the transcript runs out, every beat from that point on is
  // uncovered. Spread them proportionally by word count across the time
  // between the last real checkpoint and the transcript's end, instead of
  // collapsing every uncovered beat onto the exact same final timestamp —
  // turns "several beats flash simultaneously at the very end" into "beats
  // land at reasonable, spread-out times." (With exactly one uncovered
  // beat — the common case — this reduces to the original behavior: that
  // beat still lands exactly on the transcript's last timestamp.)
  const covered = new Set(checkpoints.map((c) => c.beat_id));
  const uncoveredBeats = beatsForFallback.filter((beat) => !covered.has(beat.id));
  if (uncoveredBeats.length > 0) {
    const anchorStart = checkpoints.length > 0 ? Math.max(...checkpoints.map((c) => c.timestamp_ms)) : 0;
    const anchorEnd = transcriptWords[transcriptWords.length - 1]?.end_ms ?? anchorStart;
    const wordCounts = uncoveredBeats.map((beat) => beat.text.split(/\s+/).filter(Boolean).length || 1);
    const totalWords = wordCounts.reduce((sum, n) => sum + n, 0);
    let cumulativeWords = 0;
    uncoveredBeats.forEach((beat, index) => {
      cumulativeWords += wordCounts[index];
      const fraction = cumulativeWords / totalWords;
      const timestamp_ms = Math.round(anchorStart + fraction * (anchorEnd - anchorStart));
      checkpoints.push({ beat_id: beat.id, timestamp_ms });
    });
  }

  const order = beatsForFallback.map((b) => b.id);
  checkpoints.sort((a, b) => order.indexOf(a.beat_id) - order.indexOf(b.beat_id));
  return checkpoints;
}

export function syncScene(
  scene: Scene,
  allTranscriptWords: TranscriptWord[],
  stallThreshold: number = DEFAULT_STALL_THRESHOLD,
): Checkpoint[] {
  return walk(tokenizeBeats(scene.beats), scene.beats, allTranscriptWords, stallThreshold, `scene ${scene.id}`);
}

// Continuous-take equivalent of syncScene(): matches one long transcript
// against every scene's beats in document order, as if the whole script were
// one scene. Used when recording_mode is "continuous" (see CLAUDE.md and
// computeSync.ts) — one recording covers every scene back to back, so sync
// has to run across all of them at once instead of scene by scene.
export function syncScript(
  scenes: Scene[],
  allTranscriptWords: TranscriptWord[],
  stallThreshold: number = DEFAULT_STALL_THRESHOLD,
): Checkpoint[] {
  const beats = scenes.flatMap((scene) => scene.beats);
  return walk(tokenizeBeats(beats), beats, allTranscriptWords, stallThreshold, "the continuous take");
}
