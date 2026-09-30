import { clipKey, recordingKey, type RecordingUploadUrlRequest, type RecordingUploadUrlResponse } from "@vaani/shared";
import { getPresignedPutUrl } from "./s3.js";

function extensionFromContentType(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  return "webm";
}

export async function getRecordingUploadUrl(
  req: RecordingUploadUrlRequest,
): Promise<RecordingUploadUrlResponse> {
  const extension = extensionFromContentType(req.content_type);
  // The audio-only companion to a continuous take (see transcribeSourceKey in
  // shared/) gets its own extension so it never collides with the full video
  // recording at the same scene id.
  const key = req.beat_id
    ? clipKey(req.script_id, req.beat_id, extension)
    : recordingKey(req.script_id, req.scene_id, req.audio_only ? `audio.${extension}` : extension);
  const upload_url = await getPresignedPutUrl(key, req.content_type);
  return { upload_url, key };
}
