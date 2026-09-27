import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ArrowRight, Play, Plus, RotateCw } from "lucide-react";
import type { ProjectStage, ProjectSummary } from "@vaani/shared";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ProjectCard, StageBadge } from "@/components/app/ProjectCard";
import { ProjectStepper } from "@/components/app/ProjectStepper";
import { WatchDialog } from "@/components/app/WatchDialog";
import { useAuth } from "@/lib/auth";
import { STAGE_ACTION, STAGE_STEPS_DONE, nextStepText, newestFirst, repoParts, videoCreationPaused } from "@/lib/stage";
import * as api from "@/lib/api";
import { CornerMarks } from "@/components/ui/corner-marks";

type Filter = "all" | "progress" | "done";
const POLL_MS = 5000;

// Kept between visits so coming back from the Studio shows the list at once
// while a fresh copy loads.
let cachedProjects: ProjectSummary[] | null = null;

function matches(filter: Filter, stage: ProjectStage): boolean {
  if (filter === "all") return true;
  if (filter === "done") return stage === "done";
  return stage !== "done";
}

// The progress bar across the top, with the next step under it. It follows the
// project you would pick up (the judge sees the newest one, since the rest are
// other people's), or explains the flow when there is nothing yet.
function FocusPanel({ project, isJudge, onWatch }: { project: ProjectSummary | null; isJudge: boolean; onWatch: (p: ProjectSummary) => void }) {
  const studioPath = project ? `/app/studio/${project.script_id}` : "/app/studio";
  return (
    <Card className="relative gap-0 overflow-hidden border border-line-strong py-0 shadow-xs">
      <CornerMarks inside />
      <div className="border-b border-line-strong px-4 py-4 sm:px-5">
        <ProjectStepper labels done={project ? STAGE_STEPS_DONE[project.stage] : 0} failed={project?.stage === "error"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        {project ? (
          <>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-xs text-muted-foreground">
                {isJudge ? "Latest project" : project.stage === "done" ? "Latest video" : "Continue where you left off"}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base font-semibold">{repoParts(project.title).name}</span>
                <StageBadge stage={project.stage} />
                <span className="font-mono text-sm text-muted-foreground">{nextStepText(project)}</span>
              </span>
            </div>
            {project.stage === "done" ? (
              <Button size="sm" onClick={() => onWatch(project)}>
                <Play data-icon="inline-start" />
                Watch video
              </Button>
            ) : (
              <Button size="sm" render={<Link to={studioPath} />}>
                {STAGE_ACTION[project.stage]}
                <ArrowRight data-icon="inline-end" />
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="max-w-2xl font-mono text-sm text-muted-foreground">
              Paste a GitHub repo and Vaani drafts the script. You read it aloud, scene by scene, and the visuals cut in on your words.
            </p>
            <Button size="sm" render={<Link to="/app/studio" />}>
              <Plus data-icon="inline-start" />
              Make your first video
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="group/box relative gap-1 border border-line-strong px-4 py-3 shadow-xs">
      <CornerMarks hover inside />
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl font-semibold tabular">{value}</span>
      {note && <span className="font-mono text-xs text-muted-foreground">{note}</span>}
    </Card>
  );
}

function NewVideoTile() {
  return (
    <Link
      to="/app/studio"
      className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-card/40 p-4 text-center font-mono text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-card">
        <Plus className="size-4" />
      </span>
      New video
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-52 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { session } = useAuth();
  const isJudge = session?.role === "judge";
  const [projects, setProjects] = useState<ProjectSummary[] | null>(cachedProjects);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [watching, setWatching] = useState<ProjectSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      cachedProjects = list;
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load projects");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyRendering = projects?.some((p) => p.stage === "rendering") ?? false;
  useEffect(() => {
    if (!anyRendering) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [anyRendering, load]);

  const sorted = useMemo(() => newestFirst(projects ?? []), [projects]);
  const visible = useMemo(() => sorted.filter((p) => matches(filter, p.stage)), [sorted, filter]);
  const inProgress = sorted.filter((p) => p.stage !== "done").length;
  const finished = sorted.length - inProgress;
  const focus = isJudge ? (sorted[0] ?? null) : (sorted.find((p) => p.stage !== "done") ?? sorted[0] ?? null);

  const limited = session?.limits !== undefined && session.usage !== undefined;
  const left = limited ? Math.max(0, session.limits!.renders - session.usage!.renders) : null;
  const paused = videoCreationPaused(session);
  const canMakeMore = left === null || left > 0;

  function copyLink(id: string) {
    void navigator.clipboard.writeText(`${window.location.origin}/app/studio/${id}`);
    toast.success("Link copied");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
        <p className="font-mono text-sm text-muted-foreground">Every locked script is a project. Pick one up where you left it.</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load your projects</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCw data-icon="inline-start" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {projects === null && !error && <LoadingState />}

      {projects !== null && (
        <>
          <FocusPanel project={focus} isJudge={isJudge} onWatch={setWatching} />

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Videos left"
              value={left === null ? "Unlimited" : String(left)}
              note={left === null ? undefined : paused ? "Paused while the hackathon is judged" : "One video, up to 3 minutes"}
            />
            <Stat label="In progress" value={String(inProgress)} />
            <Stat label="Finished" value={String(finished)} />
          </div>

          {projects.length > 0 && (
            <>
              <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
                <TabsList>
                  <TabsTrigger value="all">All ({projects.length})</TabsTrigger>
                  <TabsTrigger value="progress">In progress ({inProgress})</TabsTrigger>
                  <TabsTrigger value="done">Finished ({finished})</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {visible.map((project) => (
                  <ProjectCard key={project.script_id} project={project} showOwner={isJudge} onCopyLink={copyLink} onWatch={setWatching} />
                ))}
                {canMakeMore && filter !== "done" && <NewVideoTile />}
                {visible.length === 0 && !(canMakeMore && filter !== "done") && (
                  <p className="col-span-full py-10 text-center font-mono text-sm text-muted-foreground">Nothing here yet.</p>
                )}
              </div>
            </>
          )}
        </>
      )}

      <WatchDialog project={watching} onClose={() => setWatching(null)} />
    </div>
  );
}
