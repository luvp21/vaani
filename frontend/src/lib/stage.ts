import type { ProjectStage, ProjectSummary, Session } from "@vaani/shared";

export const STAGE_LABEL: Record<ProjectStage, string> = {
  scripted: "Script locked",
  recording: "Recording",
  synced: "Ready to render",
  rendering: "Rendering",
  done: "Video ready",
  error: "Render failed",
};

// How many of the five pipeline steps (repo, script, record, sync, video) are
// finished, for the dashboard's mini progress indicator.
export const STAGE_STEPS_DONE: Record<ProjectStage, number> = {
  scripted: 2,
  recording: 2,
  synced: 4,
  rendering: 4,
  done: 5,
  error: 4,
};

export const STAGE_ACTION: Record<ProjectStage, string> = {
  scripted: "Start recording",
  recording: "Continue recording",
  synced: "Render video",
  rendering: "View progress",
  done: "Watch video",
  error: "Retry render",
};

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// The five pipeline steps, in order. STAGE_STEPS_DONE says how many are finished,
// so the step at that index is the one in progress.
export const STEP_NAMES = ["Repo", "Script", "Record", "Sync", "Video"] as const;

// What to do next on a project, in a sentence.
export function nextStepText(project: ProjectSummary): string {
  const recorded = project.recorded_scene_ids.length;
  switch (project.stage) {
    case "scripted":
      return `Record scene 1 of ${project.scene_count}`;
    case "recording":
      return recorded >= project.scene_count
        ? "Every scene is recorded. Sync them next"
        : `Record scene ${recorded + 1} of ${project.scene_count}`;
    case "synced":
      return "Everything is synced. Render your video";
    case "rendering":
      return "Rendering your video, about a minute";
    case "done":
      return "Your video is ready to watch";
    case "error":
      return "The render failed. Retry it";
  }
}

// "owner/name" as two parts, for a two-line repo heading.
export function repoParts(title: string): { owner: string; name: string } {
  const slash = title.indexOf("/");
  return slash === -1 ? { owner: "", name: title } : { owner: title.slice(0, slash), name: title.slice(slash + 1) };
}

export function newestFirst(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, b) => b.locked_at.localeCompare(a.locked_at));
}

// True while the server has video creation paused: an account with limits then has
// none left to use (the judge and team accounts have no limits and are unaffected).
export function videoCreationPaused(session: Pick<Session, "limits"> | null | undefined): boolean {
  const limits = session?.limits;
  return limits !== undefined && limits.drafts === 0 && limits.locks === 0 && limits.renders === 0;
}

// What an account has left, in words. Judge and team accounts have no limit.
export function allowanceText(session: Pick<Session, "role" | "usage" | "limits"> | null | undefined): string | null {
  if (!session) return null;
  if (session.role === "judge") return "Sees every project";
  if (session.role === "team") return "Team account, no limits";
  if (!session.usage || !session.limits) return null;
  if (videoCreationPaused(session)) return "Video creation is paused";
  const left = Math.max(0, session.limits.renders - session.usage.renders);
  return left > 0 ? `${left} video${left === 1 ? "" : "s"} left` : "Video made";
}
