import { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, Check, ExternalLink, Pause, Play, RotateCcw, Square, Upload } from "lucide-react";
import { escapeHtml, FULL_RECORDING_ID, type Script, type TranscribeStatus } from "@vaani/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { pickSupportedAudioMimeType, pickSupportedMimeType } from "@/lib/recordingMime";
import * as api from "@/lib/api";

interface ContinuousRecorderProps {
  script: Script;
  lockedScriptId: string;
  // The one continuous take was already uploaded in an earlier session.
  alreadyRecorded?: boolean;
  onComplete: () => void;
}

type Stage = "setup" | "idle" | "recording" | "paused" | "review" | "uploading" | "uploaded";
const TRANSCRIBE_POLL_INTERVAL_MS = 5000;

// Read the whole script in one unbroken take (recording_mode: "continuous",
// see CLAUDE.md and shared/src/index.ts): no per-scene stop-and-restart, so
// the presenter's face and voice never cut in the final video, only the
// background visual changes. Alongside the main video, a small mic-only
// recording is captured for transcription (Groq's Whisper API size limit —
// see transcribeSourceKey), started and stopped in lockstep with it.
export function ContinuousRecorder({ script, lockedScriptId, alreadyRecorded = false, onComplete }: ContinuousRecorderProps) {
  const [stage, setStage] = useState<Stage>(alreadyRecorded ? "uploaded" : "setup");
  const [error, setError] = useState<string | null>(null);
  const [transcribeStatus, setTranscribeStatus] = useState<TranscribeStatus | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedVideoRef = useRef<Blob | null>(null);
  const recordedAudioRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (transcribeStatus?.status !== "in_progress") return;
    const timer = setTimeout(async () => {
      try {
        const status = await api.getTranscriptionStatus(lockedScriptId, FULL_RECORDING_ID);
        setTranscribeStatus(status);
      } catch (err) {
        setTranscribeStatus({
          script_id: lockedScriptId,
          scene_id: FULL_RECORDING_ID,
          status: "failed",
          error: err instanceof Error ? err.message : "Unexpected error",
        });
      }
    }, TRANSCRIBE_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [transcribeStatus, lockedScriptId]);

  async function enableCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (liveVideoRef.current) liveVideoRef.current.srcObject = stream;
      setStage("idle");
    } catch (err) {
      setError(err instanceof Error ? `Couldn't access camera/mic: ${err.message}` : "Couldn't access camera/mic");
    }
  }

  function popOutPrompter() {
    const popup = window.open("", "vaani-prompter", "popup,width=560,height=900");
    if (!popup) {
      setError("Your browser blocked the pop-out window. Allow pop-ups for this site and try again.");
      return;
    }
    const sections = script.scenes
      .map((scene) => {
        const lines = scene.beats.map((beat) => `<p>${escapeHtml(beat.text)}</p>`).join("");
        return `<section><h4>${escapeHtml(scene.title)}</h4>${lines}</section>`;
      })
      .join("");
    popup.document.title = "Vaani prompter";
    popup.document.body.innerHTML = `<style>body{margin:0;padding:28px;background:#23272e;color:#eceff4;font:26px/1.5 system-ui,sans-serif}h4{margin:28px 0 18px;font:600 15px system-ui;color:#9199a8}section:first-child h4{margin-top:0}p{margin:0 0 20px}</style>${sections}`;
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    setError(null);
    videoChunksRef.current = [];
    audioChunksRef.current = [];

    // Both recorders start in the same tick, on the same live stream's
    // tracks, so their timelines line up: the audio-only one exists purely
    // for a smaller transcription upload, not as a second take.
    const videoRecorder = new MediaRecorder(
      new MediaStream([...stream.getVideoTracks(), ...stream.getAudioTracks()]),
      { mimeType: pickSupportedMimeType() },
    );
    videoRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) videoChunksRef.current.push(e.data);
    };
    videoRecorder.onstop = () => {
      const blob = new Blob(videoChunksRef.current, { type: videoRecorder.mimeType });
      recordedVideoRef.current = blob;
      if (reviewVideoRef.current) reviewVideoRef.current.src = URL.createObjectURL(blob);
      setStage("review");
    };

    const audioRecorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), {
      mimeType: pickSupportedAudioMimeType(),
      audioBitsPerSecond: 48_000,
    });
    audioRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    audioRecorder.onstop = () => {
      recordedAudioRef.current = new Blob(audioChunksRef.current, { type: audioRecorder.mimeType });
    };

    videoRecorderRef.current = videoRecorder;
    audioRecorderRef.current = audioRecorder;
    videoRecorder.start();
    audioRecorder.start();
    setStage("recording");
  }

  function pauseRecording() {
    if (videoRecorderRef.current?.state !== "recording") return;
    videoRecorderRef.current.pause();
    audioRecorderRef.current?.pause();
    setStage("paused");
  }

  function resumeRecording() {
    if (videoRecorderRef.current?.state !== "paused") return;
    videoRecorderRef.current.resume();
    audioRecorderRef.current?.resume();
    setStage("recording");
  }

  function stopRecording() {
    const state = videoRecorderRef.current?.state;
    if (state === "recording" || state === "paused") {
      videoRecorderRef.current?.stop();
      audioRecorderRef.current?.stop();
    }
  }

  function retake() {
    recordedVideoRef.current = null;
    recordedAudioRef.current = null;
    if (reviewVideoRef.current) reviewVideoRef.current.src = "";
    setStage("idle");
    if (liveVideoRef.current && streamRef.current) liveVideoRef.current.srcObject = streamRef.current;
  }

  async function confirmAndUpload() {
    const video = recordedVideoRef.current;
    const audio = recordedAudioRef.current;
    if (!video || !audio) return;
    setError(null);
    setStage("uploading");
    try {
      const [videoUrl, audioUrl] = await Promise.all([
        api.getRecordingUploadUrl(lockedScriptId, FULL_RECORDING_ID, video.type),
        api.getRecordingUploadUrl(lockedScriptId, FULL_RECORDING_ID, audio.type, { audioOnly: true }),
      ]);
      await Promise.all([api.uploadRecording(videoUrl.upload_url, video), api.uploadRecording(audioUrl.upload_url, audio)]);
      setStage("uploaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setStage("review");
      return;
    }
    try {
      const status = await api.startTranscription(lockedScriptId, FULL_RECORDING_ID);
      setTranscribeStatus(status);
    } catch (err) {
      setTranscribeStatus({
        script_id: lockedScriptId,
        scene_id: FULL_RECORDING_ID,
        status: "failed",
        error: err instanceof Error ? err.message : "Unexpected error",
      });
    }
  }

  const inCapture = stage === "review" || stage === "uploading" || stage === "uploaded";
  const totalWords = script.scenes.reduce((n, s) => n + s.beats.reduce((m, b) => m + b.text.split(/\s+/).filter(Boolean).length, 0), 0);

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {stage === "uploaded" ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
              <Check className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold">Your take is recorded</h3>
              <p className="max-w-prose text-sm text-muted-foreground">
                It's uploaded and being transcribed. Next, Vaani matches what you said to the script so each visual
                lands exactly when you say it.
              </p>
            </div>
            <Button onClick={onComplete}>
              Continue to sync
              <ArrowRight data-icon="inline-end" />
            </Button>
            {transcribeStatus && (
              <p className="text-xs text-muted-foreground tabular">
                {transcribeStatus.status === "in_progress" && "Transcribing your take..."}
                {transcribeStatus.status === "completed" && `Transcribed, ${transcribeStatus.words?.length ?? 0} words recognized.`}
                {transcribeStatus.status === "failed" && `Transcription failed: ${transcribeStatus.error}`}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <Card className="order-2 max-h-[36rem] overflow-y-auto lg:order-1">
            <CardContent className="flex flex-col gap-6">
              <p className="text-xs text-muted-foreground tabular">
                One take, {script.scenes.length} {script.scenes.length === 1 ? "part" : "parts"}, about {totalWords} words.
                Read straight through; the visuals get placed afterward from what you actually said.
              </p>
              {script.scenes.map((scene) => (
                <div key={scene.id} className="flex flex-col gap-3">
                  <span className="text-sm font-medium text-muted-foreground">{scene.title}</span>
                  <div className="flex flex-col gap-3 text-xl leading-relaxed">
                    {scene.beats.map((beat) => (
                      <p key={beat.id}>{beat.text}</p>
                    ))}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-fit" onClick={popOutPrompter}>
                <ExternalLink data-icon="inline-start" />
                Pop out prompter
              </Button>
            </CardContent>
          </Card>

          <div className="order-1 flex flex-col gap-3 lg:order-2 lg:sticky lg:top-4 lg:self-start">
            <div className="relative aspect-video overflow-hidden rounded-xl border bg-black/40">
              {stage === "setup" && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <Camera className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Vaani needs your camera and microphone to record.</p>
                  <Button onClick={enableCamera}>Enable camera and mic</Button>
                </div>
              )}
              <video ref={liveVideoRef} autoPlay muted playsInline className={inCapture ? "hidden" : "size-full -scale-x-100 object-cover"} />
              <video ref={reviewVideoRef} controls playsInline className={inCapture ? "size-full object-cover" : "hidden"} />
              {(stage === "recording" || stage === "paused") && (
                <Badge className="absolute top-3 left-3 gap-1.5 border-transparent bg-destructive text-background">
                  <span className={stage === "recording" ? "size-1.5 animate-pulse rounded-full bg-current" : "size-1.5 rounded-full bg-current"} />
                  {stage === "recording" ? "Recording" : "Paused"}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {stage === "idle" && (
                <Button onClick={startRecording} className="flex-1">
                  <span className="size-2 rounded-full bg-destructive" data-icon="inline-start" />
                  Start recording
                </Button>
              )}
              {stage === "recording" && (
                <>
                  <Button variant="outline" onClick={pauseRecording}>
                    <Pause data-icon="inline-start" />
                    Pause
                  </Button>
                  <Button variant="destructive" onClick={stopRecording} className="flex-1">
                    <Square data-icon="inline-start" />
                    Stop
                  </Button>
                </>
              )}
              {stage === "paused" && (
                <>
                  <Button onClick={resumeRecording} className="flex-1">
                    <Play data-icon="inline-start" />
                    Resume
                  </Button>
                  <Button variant="destructive" onClick={stopRecording}>
                    <Square data-icon="inline-start" />
                    Stop
                  </Button>
                </>
              )}
              {stage === "review" && (
                <>
                  <Button variant="outline" onClick={retake}>
                    <RotateCcw data-icon="inline-start" />
                    Start over
                  </Button>
                  <Button onClick={confirmAndUpload} className="flex-1">
                    <Upload data-icon="inline-start" />
                    Use this take
                  </Button>
                </>
              )}
              {stage === "uploading" && (
                <Button disabled className="flex-1">
                  <Spinner data-icon="inline-start" />
                  Uploading
                </Button>
              )}
            </div>

            {stage === "idle" && (
              <p className="text-xs text-muted-foreground">
                Pause if you need to gather your thoughts; the recording carries on from where you left off. Stop
                only when you're done with the whole thing — there is no per-part retake, only start over.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
