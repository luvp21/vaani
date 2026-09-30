import { test } from "node:test";
import assert from "node:assert/strict";
import type { Checkpoint, Scene } from "@vaani/shared";
import { bucketByScene } from "./computeSync.js";

function scene(id: string, beatIds: string[]): Scene {
  return {
    id,
    title: "test scene",
    beats: beatIds.map((beatId) => ({
      id: beatId,
      text: "x",
      visual_type: "slide",
      visual_spec: { visual_type: "slide", html: "" },
    })),
  };
}

// bucketByScene() splits syncScript()'s one flat, in-order checkpoint list
// (see computeSync.ts's continuous-mode path) back into per-scene
// SceneCheckpoints, the same shape syncScene() produces per scene — so every
// downstream consumer (render, videoLimit.ts's totalSpeechMs) works the same
// regardless of which mode produced the sync result.
test("bucketByScene splits a flat checkpoint list back into its original scenes, in order", () => {
  const scenes = [scene("scene-1", ["beat-1", "beat-2"]), scene("scene-2", ["beat-3"])];
  const flat: Checkpoint[] = [
    { beat_id: "beat-1", timestamp_ms: 0 },
    { beat_id: "beat-2", timestamp_ms: 1000 },
    { beat_id: "beat-3", timestamp_ms: 1500 },
  ];
  assert.deepEqual(bucketByScene(scenes, flat, 2900), [
    { scene_id: "scene-1", checkpoints: [{ beat_id: "beat-1", timestamp_ms: 0 }, { beat_id: "beat-2", timestamp_ms: 1000 }], duration_ms: 1500 },
    { scene_id: "scene-2", checkpoints: [{ beat_id: "beat-3", timestamp_ms: 1500 }], duration_ms: 1400 },
  ]);
});

test("bucketByScene's per-scene durations sum to the whole take's real length", () => {
  const scenes = [scene("scene-1", ["beat-1"]), scene("scene-2", ["beat-2"]), scene("scene-3", ["beat-3"])];
  const flat: Checkpoint[] = [
    { beat_id: "beat-1", timestamp_ms: 0 },
    { beat_id: "beat-2", timestamp_ms: 800 },
    { beat_id: "beat-3", timestamp_ms: 2200 },
  ];
  const takeEndMs = 5000;
  const scenes_ = bucketByScene(scenes, flat, takeEndMs);
  const total = scenes_.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
  assert.equal(total, takeEndMs);
});

test("bucketByScene handles a single scene (the whole take is one scene)", () => {
  const scenes = [scene("scene-1", ["beat-1", "beat-2"])];
  const flat: Checkpoint[] = [
    { beat_id: "beat-1", timestamp_ms: 0 },
    { beat_id: "beat-2", timestamp_ms: 900 },
  ];
  assert.deepEqual(bucketByScene(scenes, flat, 2000), [
    { scene_id: "scene-1", checkpoints: flat, duration_ms: 2000 },
  ]);
});
