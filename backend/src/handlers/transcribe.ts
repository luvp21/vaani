import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { TranscribeRequestSchema, transcribeSourceKey } from "@vaani/shared";
import { ZodError } from "zod";
import { markTranscriptionStarted, startTranscription } from "../lib/transcribe/index.js";
import { secured } from "./secure.js";

const lambda = new LambdaClient({});

// What the function sends itself to do the slow part in the background.
interface BackgroundJob {
  job: "transcribe";
  script_id: string;
  scene_id: string;
}

function isBackgroundJob(event: unknown): event is BackgroundJob {
  return typeof event === "object" && event !== null && (event as { job?: unknown }).job === "transcribe";
}

// API Gateway gives up after 30 seconds and a Whisper call on a longer scene
// (plus a retry) can outlast that. So the API call only marks the scene "in
// progress" and asks this same function to do the work in the background; the
// app already polls the status endpoint. When the worker fails it stores the
// failure there, so a bad transcription shows up instead of spinning forever.
// The API call, once secure.ts has checked who is calling and that the project is theirs.
const startFromApi = secured({ script: "body", heavy: true }, async (event) => {
  try {
    const parsed = TranscribeRequestSchema.parse(JSON.parse(event.body ?? "{}"));
    await markTranscriptionStarted(parsed.script_id, parsed.scene_id);
    const job: BackgroundJob = { job: "transcribe", script_id: parsed.script_id, scene_id: parsed.scene_id };
    await lambda.send(
      new InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(job)),
      }),
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ script_id: parsed.script_id, scene_id: parsed.scene_id, status: "in_progress" }),
    };
  } catch (err) {
    if (err instanceof ZodError) {
      return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
    }
    return { statusCode: 500, body: JSON.stringify({ error: (err as Error).message }) };
  }
});

export const handler = async (event: unknown): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  if (isBackgroundJob(event)) {
    // A background run only ever comes from this function invoking itself (Lambda
    // permissions allow nothing else to), so it has no user to check. Failures are
    // already written to the status by startTranscription().
    await startTranscription(event.script_id, event.scene_id, transcribeSourceKey(event.script_id, event.scene_id)).catch(
      () => undefined,
    );
    return;
  }
  return startFromApi(event as APIGatewayProxyEventV2);
};
