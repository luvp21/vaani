import { useState } from "react";
import { GitBranch, MonitorPlay } from "lucide-react";
import {
  TARGET_MINUTES_OPTIONS,
  VIDEO_FORMAT_LIST,
  VIDEO_FORMATS,
  SCRIPT_LANGUAGE_LIST,
  SCRIPT_LANGUAGES,
  DEFAULT_SCRIPT_LANGUAGE,
  DEFAULT_VIDEO_THEME,
  VIDEO_THEMES,
  hasLimits,
  MAX_VIDEO_MINUTES,
  wordBudget,
  countWords,
  estimateSeconds,
  formatDuration,
  minutesLabel,
  type ScriptLanguage,
  type VideoFormatId,
  type VideoTheme,
  type RecordingMode,
} from "@vaani/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { VideoSummary } from "@/components/VideoSummary";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { videoCreationPaused } from "@/lib/stage";

export type GeneratePhase = "ingest" | "plan" | "write";
export interface GenerateStatus {
  phase: GeneratePhase;
  done?: number;
  total?: number;
}

interface RepoFormProps {
  onSubmit: (
    repoUrl: string,
    userContext: string,
    format: VideoFormatId,
    options: { language: ScriptLanguage; theme: VideoTheme; targetMinutes?: number; sourceScript?: string; recordingMode: RecordingMode },
  ) => void;
  status: GenerateStatus | null;
}

const EXAMPLE_REPO = "https://github.com/vercel/ms";

// What to ask the user for, per format: the focus note is where real numbers,
// the product's purpose and the audience go, since those can't be read from code.
const CONTEXT_PLACEHOLDER: Record<VideoFormatId, string> = {
  code_walkthrough: "Optional. For example: how the parser handles units, and why it's one function.",
  hackathon_demo: "What does it do, who is it for, and what did you build it with? Add any real results or numbers to show (they'll be used as-is, never invented).",
  product_demo: "Who uses this and what do they get out of it? Which two or three workflows should the tour cover?",
  architecture_overview: "Optional. Which parts of the system matter most, and which tradeoffs should be called out?",
  launch_teaser: "The one-line pitch, and where people can get it.",
};

function progressCopy(status: GenerateStatus): { label: string; detail: string; value: number } {
  if (status.phase === "ingest") {
    return { label: "Reading the repo", detail: "Pulling the README, package files and a sample of source files.", value: 12 };
  }
  if (status.phase === "plan") {
    return { label: "Planning the scenes", detail: "Deciding the shape of the video and how long each scene should be.", value: 28 };
  }
  const done = status.done ?? 0;
  const total = status.total ?? 1;
  return {
    label: done >= total ? "Finishing up" : `Writing scene ${done + 1} of ${total}`,
    detail: "Each scene is written on its own, a few at a time, with its own visuals.",
    value: 30 + Math.round((done / total) * 68),
  };
}

// A numbered heading for one part of the form.
function SectionTitle({ n, children, htmlFor, id }: { n: number; children: React.ReactNode; htmlFor?: string; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded bg-secondary font-mono text-xs tabular">{n}</span>
      <Label htmlFor={htmlFor} id={id} className="text-sm font-semibold">
        {children}
      </Label>
    </div>
  );
}

export function RepoForm({ onSubmit, status }: RepoFormProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [userContext, setUserContext] = useState("");
  const [language, setLanguage] = useState<ScriptLanguage>(DEFAULT_SCRIPT_LANGUAGE);
  const [theme, setTheme] = useState<VideoTheme>(DEFAULT_VIDEO_THEME);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("scenes");
  const [format, setFormat] = useState<VideoFormatId>("hackathon_demo");
  const [minutes, setMinutes] = useState<number>(VIDEO_FORMATS.hackathon_demo.defaultMinutes);
  const [sourceScript, setSourceScript] = useState("");
  const { session } = useAuth();
  // Everyone except the judge and the team accounts makes one video of at most 3 minutes (also enforced on the server).
  const limited = session ? hasLimits(session.role) : true;
  const lengthOptions = TARGET_MINUTES_OPTIONS.filter((m) => !limited || m <= MAX_VIDEO_MINUTES);
  const maxWords = Math.round(wordBudget(MAX_VIDEO_MINUTES) * 1.1);
  const scriptWords = countWords(sourceScript);
  const hasOwnScript = scriptWords > 0;
  const scriptTooLong = limited && scriptWords > maxWords;
  const paused = videoCreationPaused(session);
  const busy = status !== null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    onSubmit(repoUrl.trim(), userContext.trim(), format, {
      language,
      theme,
      targetMinutes: hasOwnScript ? undefined : minutes,
      sourceScript: hasOwnScript ? sourceScript.trim() : undefined,
      recordingMode: limited ? "scenes" : recordingMode,
    });
  }

  if (status) {
    const copy = progressCopy(status);
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Progress value={copy.value}>
              <ProgressLabel className="flex items-center gap-2 tabular">
                <Spinner /> {copy.label}
              </ProgressLabel>
            </Progress>
            <p className="text-sm text-muted-foreground">{copy.detail}</p>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <Card>
        <CardContent className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <SectionTitle n={1} htmlFor="repo-url">
              GitHub repository
            </SectionTitle>
            <div className="relative">
              <GitBranch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="repo-url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={busy}
                required
                className="h-10 pl-9 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              No repo handy?
              <Button type="button" variant="outline" size="xs" onClick={() => setRepoUrl(EXAMPLE_REPO)}>
                Use vercel/ms
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle n={2} id="format-label">
              What kind of video?
            </SectionTitle>
            <RadioGroup
              aria-labelledby="format-label"
              value={format}
              onValueChange={(value) => {
                setFormat(value as VideoFormatId);
                setMinutes(VIDEO_FORMATS[value as VideoFormatId].defaultMinutes);
              }}
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
            >
              {VIDEO_FORMAT_LIST.map((f) => (
                <label
                  key={f.id}
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-colors hover:bg-accent/40",
                    format === f.id && "border-primary bg-primary/5",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <RadioGroupItem value={f.id} />
                    <span className="text-sm font-medium">{f.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{f.tagline}</span>
                  <span className="mt-auto flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="tabular">{f.length}</Badge>
                    {f.screenShare === "required" && (
                      <Badge variant="outline" className="gap-1">
                        <MonitorPlay className="size-3" />
                        Your product
                      </Badge>
                    )}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </section>

          <section className="flex flex-col gap-5">
            <SectionTitle n={3} htmlFor="user-context">
              {format === "code_walkthrough" ? "What should the video focus on?" : "Tell Vaani about it"}
            </SectionTitle>
            <Textarea
              id="user-context"
              placeholder={CONTEXT_PLACEHOLDER[format]}
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              disabled={busy}
              rows={4}
            />

            <div className="flex flex-wrap gap-x-10 gap-y-5">
              <div className="flex max-w-xs flex-col gap-2">
                <Label id="language-label">Script language</Label>
                <Tabs value={language} onValueChange={(value) => setLanguage(value as ScriptLanguage)} aria-labelledby="language-label">
                  <TabsList>
                    {SCRIPT_LANGUAGE_LIST.map((l) => (
                      <TabsTrigger key={l.id} value={l.id} disabled={busy}>
                        {l.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">{SCRIPT_LANGUAGES[language].description}</p>
              </div>

              <div className="flex max-w-xs flex-col gap-2">
                <Label id="length-label">How long should it be?</Label>
                <Tabs value={String(minutes)} onValueChange={(value) => setMinutes(Number(value))} aria-labelledby="length-label">
                  <TabsList className={hasOwnScript ? "opacity-50" : undefined}>
                    {lengthOptions.map((m) => (
                      <TabsTrigger key={m} value={String(m)} disabled={hasOwnScript || busy} className="tabular">
                        {minutesLabel(m)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {hasOwnScript
                    ? "Your own script sets the length, so this is off."
                    : limited
                      ? `About 135 spoken words per minute. Limited to ${MAX_VIDEO_MINUTES} minutes.`
                      : "About 135 spoken words per minute."}
                </p>
              </div>

              <div className="flex max-w-xs flex-col gap-2">
                <Label id="theme-label">Slide theme</Label>
                <Tabs value={theme} onValueChange={(value) => setTheme(value as VideoTheme)} aria-labelledby="theme-label">
                  <TabsList>
                    {(Object.keys(VIDEO_THEMES) as VideoTheme[]).map((t) => (
                      <TabsTrigger key={t} value={t} disabled={busy}>
                        {VIDEO_THEMES[t].name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">{VIDEO_THEMES[theme].description}</p>
              </div>

              {/* Reading one long take instead of scene by scene is only for accounts with
                  no length limit — it's meant for long-form videos well past 3 minutes. */}
              {!limited && (
                <div className="flex max-w-xs flex-col gap-2">
                  <Label id="recording-mode-label">Recording</Label>
                  <Tabs
                    value={recordingMode}
                    onValueChange={(value) => setRecordingMode(value as RecordingMode)}
                    aria-labelledby="recording-mode-label"
                  >
                    <TabsList>
                      <TabsTrigger value="scenes" disabled={busy}>
                        Scene by scene
                      </TabsTrigger>
                      <TabsTrigger value="continuous" disabled={busy}>
                        One take
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className="text-xs text-muted-foreground">
                    {recordingMode === "continuous"
                      ? "Read the whole script in one unbroken take. No scene cuts in the final video."
                      : "Record and retake each scene on its own."}
                  </p>
                </div>
              )}
            </div>
          </section>

          <details className="group rounded-lg border border-line-strong px-4 py-3" open={hasOwnScript}>
            <summary className="cursor-pointer select-none font-mono text-sm font-medium">
              Already have a script? <span className="font-normal text-muted-foreground">(optional)</span>
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              <Textarea
                id="source-script"
                aria-label="Your own script"
                placeholder="Paste your narration here. Vaani keeps your words and builds the slides, diagrams and demo beats around them."
                value={sourceScript}
                onChange={(e) => setSourceScript(e.target.value)}
                disabled={busy}
                rows={5}
              />
              {hasOwnScript && (
                <p className={cn("text-xs tabular", scriptTooLong ? "text-destructive" : "text-muted-foreground")}>
                  {scriptWords} words, about {formatDuration(estimateSeconds(sourceScript))} spoken.
                  {scriptTooLong && ` That's over the ${MAX_VIDEO_MINUTES} minute limit, so please shorten it.`}
                </p>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <aside className="lg:sticky lg:top-20">
        <VideoSummary
          format={format}
          language={language}
          theme={theme}
          minutes={minutes}
          ownScriptWords={scriptWords}
          limited={limited}
          paused={paused}
          disabled={busy || paused || !repoUrl.trim() || scriptTooLong}
        />
      </aside>
    </form>
  );
}
