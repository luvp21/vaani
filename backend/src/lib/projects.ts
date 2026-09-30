import {
  FULL_RECORDING_ID,
  lockedScriptKey,
  renderStatusKey,
  type LockedScript,
  type ProjectDetail,
  type ProjectStage,
  type ProjectSummary,
  type RenderStatus,
} from "@vaani/shared";
import { getJson, listObjects } from "./s3.js";
import { getLockedScript } from "./lockScript.js";
import { getRenderStatus } from "./render/status.js";
import { canAccess, type Auth } from "./auth/access.js";

const MAX_PROJECTS = 30;
const UUID_KEY = /^scripts\/([0-9a-f-]{36})\.json$/;

function repoName(repoUrl: string): string {
  return repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "");
}

function deriveStage(recordedCount: number, synced: boolean, render: RenderStatus["status"] | null): ProjectStage {
  if (render === "done") return "done";
  if (render === "error") return "error";
  if (render === "pending" || render === "running") return "rendering";
  if (synced) return "synced";
  if (recordedCount > 0) return "recording";
  return "scripted";
}

// A continuous take stores one recording under the FULL_RECORDING_ID
// sentinel, not one per scene — so the raw S3 listing only ever shows that
// one id, never the real scene ids. Everything downstream (deriveStage, the
// dashboard, Studio's stepForProject) compares recorded_scene_ids.length
// against scene_count, so once the one continuous recording exists, report
// every real scene id as recorded: to every consumer this then looks exactly
// like a "scenes" mode project where every scene finished recording.
function resolvedRecordedSceneIds(locked: LockedScript, rawRecordedIds: string[]): string[] {
  if (locked.script.recording_mode === "continuous" && rawRecordedIds.includes(FULL_RECORDING_ID)) {
    return locked.script.scenes.map((s) => s.id);
  }
  return rawRecordedIds;
}

function summarize(
  locked: LockedScript,
  rawRecordedSceneIds: string[],
  synced: boolean,
  renderStatus: RenderStatus["status"] | null,
): ProjectSummary {
  const recordedSceneIds = resolvedRecordedSceneIds(locked, rawRecordedSceneIds);
  const beatCount = locked.script.scenes.reduce((sum, scene) => sum + scene.beats.length, 0);
  return {
    script_id: locked.script_id,
    repo_url: locked.script.repo_url,
    title: repoName(locked.script.repo_url),
    scene_count: locked.script.scenes.length,
    beat_count: beatCount,
    recorded_scene_ids: recordedSceneIds,
    synced,
    render_status: renderStatus,
    stage: deriveStage(recordedSceneIds.length, synced, renderStatus),
    locked_at: locked.locked_at,
    ...(locked.owner ? { owner: locked.owner } : {}),
    ...(locked.owner_name ? { owner_name: locked.owner_name } : {}),
  };
}

// One listing per prefix (not one request per project) — the dashboard needs
// to know, for every script, which recordings/sync/render artifacts exist.
async function artifactIndex() {
  const [recordings, syncs, renders] = await Promise.all([
    listObjects("recordings/"),
    listObjects("sync/"),
    listObjects("renders/"),
  ]);
  const recordedByProject = new Map<string, string[]>();
  for (const { key } of recordings) {
    const match = /^recordings\/([^/]+)\/([^/.]+)\.[a-z0-9]+$/.exec(key);
    if (!match) continue;
    recordedByProject.set(match[1], [...(recordedByProject.get(match[1]) ?? []), match[2]]);
  }
  const synced = new Set(syncs.map(({ key }) => /^sync\/([^/]+)\/result\.json$/.exec(key)?.[1]).filter(Boolean) as string[]);
  const rendered = new Set(
    renders.map(({ key }) => /^renders\/([^/]+)\/status\.json$/.exec(key)?.[1]).filter(Boolean) as string[],
  );
  return { recordedByProject, synced, rendered };
}

// A tester sees only the projects they made; the judge sees every account's.
export async function listProjects(auth?: Auth): Promise<ProjectSummary[]> {
  const all = await listAllProjects();
  return auth ? all.filter((p) => canAccess(auth, p.owner)) : all;
}

async function listAllProjects(): Promise<ProjectSummary[]> {
  const scripts = (await listObjects("scripts/"))
    .filter(({ key }) => UUID_KEY.test(key))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
    .slice(0, MAX_PROJECTS);
  const { recordedByProject, synced, rendered } = await artifactIndex();

  return Promise.all(
    scripts.map(async ({ key }) => {
      const scriptId = UUID_KEY.exec(key)![1];
      const locked = await getJson<LockedScript>(lockedScriptKey(scriptId));
      const renderStatus = rendered.has(scriptId)
        ? (await getJson<RenderStatus>(renderStatusKey(scriptId))).status
        : null;
      return summarize(locked, recordedByProject.get(scriptId) ?? [], synced.has(scriptId), renderStatus);
    }),
  );
}

export async function getProject(scriptId: string): Promise<ProjectDetail> {
  const locked = await getLockedScript(scriptId);
  const { recordedByProject, synced, rendered } = await artifactIndex();
  const render = rendered.has(scriptId) ? await getRenderStatus(scriptId) : null;
  return {
    locked,
    summary: summarize(locked, recordedByProject.get(scriptId) ?? [], synced.has(scriptId), render?.status ?? null),
    render,
  };
}
