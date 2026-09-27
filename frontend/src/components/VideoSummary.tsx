import { ArrowRight, Camera, MonitorPlay } from "lucide-react";
import { MAX_VIDEO_MINUTES, SCRIPT_LANGUAGES, VIDEO_FORMATS, VIDEO_THEMES, wordBudget, minutesLabel } from "@vaani/shared";
import type { ScriptLanguage, VideoFormatId, VideoTheme } from "@vaani/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CornerMarks } from "@/components/ui/corner-marks";

interface VideoSummaryProps {
  format: VideoFormatId;
  language: ScriptLanguage;
  theme: VideoTheme;
  minutes: number;
  // Set when the user pasted their own script: its length sets the video's.
  ownScriptWords: number;
  limited: boolean;
  // Video creation is switched off for this account for now.
  paused: boolean;
  disabled: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-strong/60 py-2 last:border-b-0">
      <dt className="font-mono text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-sm font-medium tabular">{value}</dd>
    </div>
  );
}

// A live summary of what is about to be made, next to the submit button, so
// the choices are visible in one place and the button never scrolls away.
export function VideoSummary({ format, language, theme, minutes, ownScriptWords, limited, paused, disabled }: VideoSummaryProps) {
  const f = VIDEO_FORMATS[format];
  const hasOwnScript = ownScriptWords > 0;
  return (
    <Card className="relative gap-4 border border-line-strong p-4 shadow-xs">
      <CornerMarks inside />
      <div className="flex flex-col gap-0.5">
        <h2 className="font-mono text-sm font-semibold">Your video</h2>
        <p className="font-mono text-xs text-muted-foreground">{f.tagline}</p>
      </div>
      <dl className="flex flex-col">
        <Row label="Type" value={f.name} />
        <Row label="Length" value={hasOwnScript ? "Set by your script" : minutesLabel(minutes)} />
        <Row label="Words" value={hasOwnScript ? `${ownScriptWords} (yours)` : `about ${wordBudget(minutes)}`} />
        <Row label="Language" value={SCRIPT_LANGUAGES[language].name} />
        <Row label="Slides" value={VIDEO_THEMES[theme].name} />
      </dl>
      <div className="flex flex-col gap-1.5 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Camera className="size-3.5 shrink-0" />
          You'll need a camera and mic to record.
        </span>
        {f.screenShare !== "none" && (
          <span className="flex items-center gap-2">
            <MonitorPlay className="size-3.5 shrink-0" />
            {f.screenShare === "required" ? "You'll share a browser tab to show your product." : "You can share a browser tab to show your product."}
          </span>
        )}
      </div>
      <Button type="submit" size="lg" disabled={disabled} className="w-full">
        Draft the script
        <ArrowRight data-icon="inline-end" />
      </Button>
      {paused ? (
        <p className="text-center font-mono text-xs text-muted-foreground">New videos are paused while the hackathon is being judged.</p>
      ) : (
        limited && <p className="text-center font-mono text-xs text-muted-foreground">One video, up to {MAX_VIDEO_MINUTES} minutes.</p>
      )}
    </Card>
  );
}
