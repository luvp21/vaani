import Groq, { toFile } from "groq-sdk";
import {
  FULL_RECORDING_ID,
  transcribeOutputKey,
  type ScriptLanguage,
  type TranscribeStatus,
  type TranscriptWord,
} from "@vaani/shared";
import { getBuffer, putJson, getJson } from "../s3.js";
import { getLockedScript } from "../lockScript.js";
import { transliterateTranscript } from "../sync/transliterate.js";
import { wordsMatch } from "../sync/matches.js";

function client(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY env var is not set");
  return new Groq({ apiKey });
}

// Groq's response type only declares `text` — the actual verbose_json body
// (confirmed against a live call, not assumed) also carries `words` when
// timestamp_granularities includes "word".
interface GroqWord {
  word: string;
  start: number;
  end: number;
}
interface GroqVerboseTranscription {
  text: string;
  words?: GroqWord[];
}

// Whisper's `prompt` biases both vocabulary and spelling toward what it's
// shown. Found by a real end-to-end test: on Polly-voiced Hinglish, Whisper
// wrote English terms in Devanagari ("फंक्शन"), and priming it with the scene's
// own script (same Latin Hinglish, same term spellings) fixed that. Capped:
// Whisper only uses the last ~224 tokens of a prompt anyway.
const MAX_PROMPT_CHARS = 800;

// Language handling, learned from real runs (see PROGRESS.md): forcing
// language "en" looked great on some scenes and failed badly on others — on the
// SAME audio it produced a hallucinated one-liner ("Let's see how to execute
// this."), a translation to English, or a truncated transcript. Letting Whisper
// auto-detect while priming it with the scene's own script was faithful every
// time, but writes Hindi words in Devanagari. So: auto-detect + prompt, then
// convert Devanagari to Latin here so everything stored is plain English
// letters, matching the script's Hinglish spelling. WHISPER_LANGUAGE can force
// a language for the first attempt.
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || undefined;

// A transcript that matches under half of the script's words is wrong however
// long it is: Whisper invents stock phrases from unclear audio ("Let's see how
// to execute this.") and, in auto-detect mode, sometimes translates Hindi into
// English (a fluent, full-length transcript that matches nothing in the
// script). Both real. Below this share we retry with another setting.
const MIN_MATCH_COVERAGE = 0.5;

interface Attempt {
  label: string;
  language?: string;
  usePrompt: boolean;
}

interface SceneContext {
  prompt: string;
  scriptText: string;
  language: ScriptLanguage;
}

async function sceneContext(scriptId: string, sceneId: string): Promise<SceneContext | undefined> {
  try {
    const locked = await getLockedScript(scriptId);
    // A continuous take covers every scene, so its prompt and coverage check
    // are built from the whole script's text, not one scene's.
    const beats =
      sceneId === FULL_RECORDING_ID
        ? locked.script.scenes.flatMap((s) => s.beats)
        : locked.script.scenes.find((s) => s.id === sceneId)?.beats;
    if (!beats) return undefined;
    const text = beats.map((b) => b.text).join(" ");
    return {
      prompt: text.slice(-MAX_PROMPT_CHARS),
      scriptText: text,
      language: locked.script.language,
    };
  } catch {
    // No script to prime with (e.g. transcribing a loose recording): plain
    // transcription still works, just without the vocabulary hint.
    return undefined;
  }
}

// Share of the script's words that the transcript reproduces, walking both in
// order (each script word must be found after the previous one).
export function scriptCoverage(scriptText: string, words: TranscriptWord[]): number {
  const script = scriptText.split(/\s+/).filter(Boolean);
  if (script.length === 0) return 1;
  let matched = 0;
  let j = 0;
  for (const scriptWord of script) {
    for (let k = j; k < words.length; k++) {
      if (wordsMatch(scriptWord, words[k].text)) {
        matched += 1;
        j = k + 1;
        break;
      }
    }
  }
  return matched / script.length;
}

// Picks the first transcript that matches enough of the script, else the best.
export function pickTranscript(candidates: TranscriptWord[][], scriptText: string): TranscriptWord[] {
  const scored = candidates.map((words) => ({ words, score: scriptCoverage(scriptText, words) }));
  const good = scored.find((c) => c.score >= MIN_MATCH_COVERAGE);
  if (good) return good.words;
  return scored.reduce((best, c) => (c.score > best.score ? c : best), scored[0]).words;
}

// What is stored at the transcript key. "in_progress" is written the moment a
// transcription is requested, which also replaces the transcript of an earlier
// take when a scene is re-recorded (otherwise a poll would return the old one).
export type StoredResult =
  | { status: "in_progress"; started_at: string }
  | { status: "completed"; words: TranscriptWord[] }
  | { status: "failed"; error: string };

// A worker that dies without reporting (a Lambda timeout, say) leaves the marker
// behind. Past this age it counts as failed, so the app stops waiting.
const STALE_AFTER_MS = 5 * 60 * 1000;

export async function markTranscriptionStarted(scriptId: string, sceneId: string): Promise<void> {
  const marker: StoredResult = { status: "in_progress", started_at: new Date().toISOString() };
  await putJson(transcribeOutputKey(scriptId, sceneId), marker);
}

// Transcription is Whisper via Groq, not AWS Transcribe (which was tried first): Transcribe's
// per-segment language ID mangled consecutive English loanwords ("async function" heard as
// "tracing function") in a way transliteration, looser matching and a custom vocabulary
// couldn't fix. Groq's API is a single synchronous call (no job polling), so the result is
// written straight to the S3 key the status endpoint reads.
async function transcribeOnce(audio: Buffer, params: { language?: string; prompt?: string }): Promise<TranscriptWord[]> {
  const file = await toFile(audio, "recording.webm");
  const response = (await client().audio.transcriptions.create({
    model: "whisper-large-v3",
    file,
    ...(params.language ? { language: params.language } : {}),
    ...(params.prompt ? { prompt: params.prompt } : {}),
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    temperature: 0,
  })) as unknown as GroqVerboseTranscription;

  const words = (response.words ?? []).map((w) => ({
    text: w.word,
    start_ms: Math.round(w.start * 1000),
    end_ms: Math.round(w.end * 1000),
  }));
  // Devanagari to Latin here, so what is stored (and shown) is English letters.
  return transliterateTranscript(words);
}

// The settings to try, in order. Without a script there is nothing to prime or
// score against, so it's one plain attempt. An English script has no Hindi to
// detect, so it says "en" up front (forcing "en" on Hinglish hallucinates, see
// above); Hinglish keeps auto-detect first.
export function attemptsFor(language: ScriptLanguage | undefined): Attempt[] {
  if (!language) return [{ label: "auto", language: WHISPER_LANGUAGE, usePrompt: false }];
  const all: Attempt[] = [
    language === "en"
      ? { label: "english + script prompt", language: "en", usePrompt: true }
      : { label: "auto + script prompt", language: WHISPER_LANGUAGE, usePrompt: true },
    { label: "english + script prompt", language: "en", usePrompt: true },
    { label: "hindi + script prompt", language: "hi", usePrompt: true },
    { label: "english, no prompt", language: "en", usePrompt: false },
  ];
  // An English script would otherwise repeat the same request twice.
  return all.filter((a, i) => all.findIndex((b) => b.language === a.language && b.usePrompt === a.usePrompt) === i);
}

export async function startTranscription(scriptId: string, sceneId: string, recordingKey: string): Promise<void> {
  try {
    await transcribeScene(scriptId, sceneId, recordingKey);
  } catch (err) {
    // Report it where the app is looking, then let the caller see it too.
    const failed: StoredResult = { status: "failed", error: err instanceof Error ? err.message : "Transcription failed" };
    await putJson(transcribeOutputKey(scriptId, sceneId), failed);
    throw err;
  }
}

async function transcribeScene(scriptId: string, sceneId: string, recordingKey: string): Promise<void> {
  const audio = await getBuffer(recordingKey);
  const context = await sceneContext(scriptId, sceneId);

  const attempts = attemptsFor(context?.language);

  const candidates: TranscriptWord[][] = [];
  for (const attempt of attempts) {
    const words = await transcribeOnce(audio, {
      language: attempt.language,
      prompt: attempt.usePrompt ? context?.prompt : undefined,
    });
    candidates.push(words);
    if (!context) break;
    const coverage = scriptCoverage(context.scriptText, words);
    if (coverage >= MIN_MATCH_COVERAGE) break;
    console.warn(
      `transcribe: "${attempt.label}" only matched ${Math.round(coverage * 100)}% of the script (${sceneId}); trying another setting`,
    );
  }

  const words = context ? pickTranscript(candidates, context.scriptText) : candidates[0];
  const result: StoredResult = { status: "completed", words };
  await putJson(transcribeOutputKey(scriptId, sceneId), result);
}

// What the app should be told for whatever is stored. Pure, so it can be tested.
export function statusFromStored(
  scriptId: string,
  sceneId: string,
  stored: StoredResult | null,
  now: number = Date.now(),
): TranscribeStatus {
  const base = { script_id: scriptId, scene_id: sceneId };
  // Nothing written yet: a poll that raced the request.
  if (!stored) return { ...base, status: "in_progress" };
  if (stored.status === "completed") return { ...base, status: "completed", words: stored.words };
  if (stored.status === "failed") return { ...base, status: "failed", error: stored.error };
  if (now - new Date(stored.started_at).getTime() > STALE_AFTER_MS) {
    return { ...base, status: "failed", error: "Transcription timed out. Re-record or retry this scene." };
  }
  return { ...base, status: "in_progress" };
}

export async function getTranscriptionStatus(scriptId: string, sceneId: string): Promise<TranscribeStatus> {
  const stored = await getJson<StoredResult>(transcribeOutputKey(scriptId, sceneId)).catch(() => null);
  return statusFromStored(scriptId, sceneId, stored);
}
