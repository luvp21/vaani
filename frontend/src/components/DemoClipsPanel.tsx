import { useEffect, useRef, useState } from "react";
import { Check, MonitorPlay, Pause, Play, RotateCcw, Square, Upload } from "lucide-react";
import { WARN_CLIP_SPEED, clipSpeed, estimateSeconds, formatDuration, type Beat } from "@vaani/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { pickSupportedMimeType } from "@/lib/recordingMime";
import * as api from "@/lib/api";

interface DemoClipsPanelProps {
  // The scene's product-demo beats: one silent screen clip per step.
  beats: Beat[];
  lockedScriptId: string;
  sceneId: string;
}

type ClipState = "empty" | "recording" | "paused" | "review" | "uploading" | "done";

// Records each demo step as its own silent screen clip, apart from the
// narration. That keeps the microphone free for the product being demoed (a
// voice bot, for instance), lets the presenter get the app into the right state
// first, skip waits with pause, and retake a step without redoing the scene.
// What the render will do with a clip, in words, so the mismatch shows up here
// and not only in the finished video. The narration length is an estimate
// (word count at speaking pace), hence "about".
function fitHint(clipSeconds: number | undefined, narrationSeconds: number): { text: string; warn: boolean } | null {
  if (!clipSeconds) return null;
  const clip = formatDuration(clipSeconds);
  const narration = formatDuration(narrationSeconds);
  const speed = clipSpeed(clipSeconds, narrationSeconds);
  if (speed <= 1) {
    return clipSeconds < narrationSeconds * 0.5
      ? { text: `Clip ${clip}, narration about ${narration}. The last frame will hold for the rest of it.`, warn: false }
      : { text: `Clip ${clip}, narration about ${narration}. Fits.`, warn: false };
  }
  if (speed > WARN_CLIP_SPEED) {
    return {
      text: `Clip ${clip}, narration about ${narration}: it would play at ${speed.toFixed(0)}x and be hard to follow. Re-record and pause through the waiting, or write a longer line for this step.`,
      warn: true,
    };
  }
  return { text: `Clip ${clip}, narration about ${narration}. It will be sped up ${speed.toFixed(1)}x to fit, and end on the result.`, warn: false };
}

export function DemoClipsPanel({ beats, lockedScriptId, sceneId }: DemoClipsPanelProps) {
  const [sharing, setSharing] = useState(false);
  const [states, setStates] = useState<Record<string, ClipState>>({});
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const screenRef = useRef<MediaStream | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobsRef = useRef<Record<string, Blob>>({});
  const urlsRef = useRef<Record<string, string>>({});
  // Recorded time excluding pauses. A browser-made webm reports no duration
  // (it reads as Infinity), so the take is timed here instead.
  const timerRef = useRef({ startedAt: 0, banked: 0 });

  const stateOf = (id: string): ClipState => states[id] ?? "empty";
  const setState = (id: string, state: ClipState) => setStates((prev) => ({ ...prev, [id]: state }));
  const doneCount = beats.filter((b) => stateOf(b.id) === "done").length;

  useEffect(() => {
    urlsRef.current = urls;
  }, [urls]);

  useEffect(() => {
    return () => {
      screenRef.current?.getTracks().forEach((track) => track.stop());
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (sharing && liveRef.current && screenRef.current) liveRef.current.srcObject = screenRef.current;
  }, [sharing]);

  async function shareScreen() {
    setError(null);
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      screenRef.current = screen;
      // Stopping from the browser's own "stop sharing" bar ends any take in progress cleanly.
      screen.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
        screenRef.current = null;
        setSharing(false);
      });
      setSharing(true);
    } catch (err) {
      setError(err instanceof Error ? `Couldn't share your screen: ${err.message}` : "Couldn't share your screen");
    }
  }

  function start(beat: Beat) {
    const screen = screenRef.current;
    if (!screen) return;
    setError(null);
    chunksRef.current = [];
    const recorder = new MediaRecorder(screen, { mimeType: pickSupportedMimeType() });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const timer = timerRef.current;
      const running = timer.startedAt > 0 ? performance.now() - timer.startedAt : 0;
      const seconds = (timer.banked + running) / 1000;
      setLengths((prev) => ({ ...prev, [beat.id]: seconds }));
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      blobsRef.current[beat.id] = blob;
      setUrls((prev) => {
        if (prev[beat.id]) URL.revokeObjectURL(prev[beat.id]);
        return { ...prev, [beat.id]: URL.createObjectURL(blob) };
      });
      setState(beat.id, "review");
    };
    recorderRef.current = recorder;
    timerRef.current = { startedAt: performance.now(), banked: 0 };
    recorder.start();
    setActiveId(beat.id);
    setState(beat.id, "recording");
  }

  function togglePause(beat: Beat) {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      timerRef.current = { startedAt: 0, banked: timerRef.current.banked + performance.now() - timerRef.current.startedAt };
      recorder.pause();
      setState(beat.id, "paused");
    } else if (recorder.state === "paused") {
      timerRef.current = { ...timerRef.current, startedAt: performance.now() };
      recorder.resume();
      setState(beat.id, "recording");
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  async function keep(beat: Beat) {
    const blob = blobsRef.current[beat.id];
    if (!blob) return;
    setError(null);
    setState(beat.id, "uploading");
    try {
      const { upload_url } = await api.getRecordingUploadUrl(lockedScriptId, sceneId, blob.type, { beatId: beat.id });
      await api.uploadRecording(upload_url, blob);
      setState(beat.id, "done");
      setActiveId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setState(beat.id, "review");
    }
  }

  function retake(beat: Beat) {
    delete blobsRef.current[beat.id];
    setState(beat.id, "empty");
    setActiveId(null);
  }

  const busy = activeId !== null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <MonitorPlay className="size-4 text-highlight" />
              Demo clips for this scene
            </h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              Record each step on its own, without talking. Set your app up first, pause to skip any waiting, and retake
              freely. You narrate over the clips afterwards, so your microphone stays free for the app.
            </p>
          </div>
          <Badge variant="secondary" className="tabular">
            {doneCount}/{beats.length} recorded
          </Badge>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!sharing ? (
          <Button onClick={shareScreen} className="w-fit">
            <MonitorPlay data-icon="inline-start" />
            Share the tab with your app
          </Button>
        ) : (
          <video
            ref={liveRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full max-w-sm rounded-lg border bg-black/40 object-contain"
          />
        )}

        <ol className="flex flex-col gap-3">
          {beats.map((beat, i) => {
            const state = stateOf(beat.id);
            const isActive = activeId === beat.id;
            return (
              <li key={beat.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular">
                      {state === "done" ? <Check className="size-3 text-success" /> : i + 1}
                    </span>
                    <span>{beat.visual_spec.visual_type === "ui_demo" ? beat.visual_spec.note || "Show the product" : ""}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {state === "empty" && (
                      <Button size="sm" disabled={!sharing || (busy && !isActive)} onClick={() => start(beat)}>
                        <span className="size-2 rounded-full bg-destructive" data-icon="inline-start" />
                        Record step
                      </Button>
                    )}
                    {(state === "recording" || state === "paused") && (
                      <>
                        <Badge className="gap-1.5 border-transparent bg-destructive text-background">
                          <span className={state === "recording" ? "size-1.5 animate-pulse rounded-full bg-current" : "size-1.5 rounded-full bg-current"} />
                          {state === "recording" ? "Recording" : "Paused"}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => togglePause(beat)}>
                          {state === "recording" ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                          {state === "recording" ? "Pause" : "Resume"}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={stop}>
                          <Square data-icon="inline-start" />
                          Stop
                        </Button>
                      </>
                    )}
                    {state === "review" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => retake(beat)}>
                          <RotateCcw data-icon="inline-start" />
                          Re-record
                        </Button>
                        <Button size="sm" onClick={() => keep(beat)}>
                          <Upload data-icon="inline-start" />
                          Use this clip
                        </Button>
                      </>
                    )}
                    {state === "uploading" && (
                      <Button size="sm" disabled>
                        <Spinner data-icon="inline-start" />
                        Uploading
                      </Button>
                    )}
                    {state === "done" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => retake(beat)}>
                        <RotateCcw data-icon="inline-start" />
                        Re-record
                      </Button>
                    )}
                  </span>
                </div>
                {(state === "review" || state === "uploading" || state === "done") && (() => {
                  const hint = fitHint(lengths[beat.id], estimateSeconds(beat.text));
                  return hint && <p className={hint.warn ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hint.text}</p>;
                })()}
                {urls[beat.id] && (state === "review" || state === "uploading" || state === "done") && (
                  <video src={urls[beat.id]} controls muted playsInline className="aspect-video w-full max-w-sm rounded-md border bg-black/40" />
                )}
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-muted-foreground">
          A step you skip shows as a text card in the video. A clip longer than your narration is sped up to fit and
          ends on its last frame, so the result is never cut off.
        </p>
      </CardContent>
    </Card>
  );
}
