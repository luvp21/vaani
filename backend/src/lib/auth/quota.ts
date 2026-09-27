import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { hasLimits, PAUSED_LIMITS, PAUSED_MESSAGE, TESTER_LIMITS, type AuthRole, type Limits, type Usage } from "@vaani/shared";

export type QuotaKind = keyof Usage;

const NOTHING_USED: Usage = { drafts: 0, locks: 0, renders: 0 };

const MESSAGES: Record<QuotaKind, string> = {
  drafts: "You've used all of this account's script drafts.",
  locks: "You've locked as many scripts as this account allows.",
  renders: "This account has already made its one video. Sign in as a different account, or ask for a reset.",
};

// A tester's usage counters. Both operations are single atomic steps, so two
// requests at the same moment can never both take the last unit: increment only
// succeeds if the counter is still below its limit, and says so.
export interface UsageStore {
  read(username: string): Promise<Usage>;
  increment(username: string, kind: QuotaKind, limit: number): Promise<boolean>;
  decrement(username: string, kind: QuotaKind): Promise<void>;
}

// One DynamoDB item per account: { username, drafts, locks, renders }.
function dynamoStore(): UsageStore {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const TableName = process.env.USAGE_TABLE;
  const table = () => {
    if (!TableName) throw new Error("USAGE_TABLE env var is not set");
    return TableName;
  };

  return {
    async read(username) {
      const { Item } = await client.send(new GetCommand({ TableName: table(), Key: { username } }));
      // Just the counters, not the key or anything else on the item.
      return {
        drafts: Number(Item?.drafts ?? 0),
        locks: Number(Item?.locks ?? 0),
        renders: Number(Item?.renders ?? 0),
      };
    },

    async increment(username, kind, limit) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: table(),
            Key: { username },
            UpdateExpression: "SET #k = if_not_exists(#k, :zero) + :one",
            ConditionExpression: "attribute_not_exists(#k) OR #k < :limit",
            ExpressionAttributeNames: { "#k": kind },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":limit": limit },
          }),
        );
        return true;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false;
        throw err;
      }
    },

    async decrement(username, kind) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: table(),
            Key: { username },
            UpdateExpression: "SET #k = #k - :one",
            // Never below zero, and nothing to give back if the counter was never set.
            ConditionExpression: "#k > :zero",
            ExpressionAttributeNames: { "#k": kind },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
          }),
        );
      } catch (err) {
        if (!(err instanceof ConditionalCheckFailedException)) throw err;
      }
    },
  };
}

// The same behaviour in memory, for tests and anywhere DynamoDB isn't wanted.
export function memoryStore(): UsageStore {
  const usage = new Map<string, Usage>();
  return {
    async read(username) {
      return { ...NOTHING_USED, ...usage.get(username) };
    },
    async increment(username, kind, limit) {
      const current = { ...NOTHING_USED, ...usage.get(username) };
      if (current[kind] >= limit) return false;
      usage.set(username, { ...current, [kind]: current[kind] + 1 });
      return true;
    },
    async decrement(username, kind) {
      const current = { ...NOTHING_USED, ...usage.get(username) };
      if (current[kind] > 0) usage.set(username, { ...current, [kind]: current[kind] - 1 });
    },
  };
}

// The limits in force right now: the normal tester limits, or all zeros while
// video creation is paused (VIDEO_CREATION_PAUSED=true, set by the stack).
export function videoCreationIsPaused(): boolean {
  return process.env.VIDEO_CREATION_PAUSED === "true";
}

export function activeLimits(): Limits {
  return videoCreationIsPaused() ? PAUSED_LIMITS : TESTER_LIMITS;
}

// While paused, accounts with limits may not use any route that spends money
// (models, transcription, voices, Fargate), not only the ones that carry a quota:
// write-scene and scene-gen have none of their own, since drafting is charged once.
export function pausedFor(role: AuthRole, spendsMoney: boolean | undefined): boolean {
  return spendsMoney === true && hasLimits(role) && videoCreationIsPaused();
}

let store: UsageStore | undefined;
function defaultStore(): UsageStore {
  return (store ??= dynamoStore());
}

export async function getUsage(username: string, using: UsageStore = defaultStore()): Promise<Usage> {
  return using.read(username);
}

// The judge and team accounts have no limits, so their calls never touch the table.
export async function consume(
  username: string,
  role: AuthRole,
  kind: QuotaKind,
  using: UsageStore = defaultStore(),
  limits: Limits = activeLimits(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!hasLimits(role)) return { ok: true };
  // A limit of zero must refuse outright: the counter check below lets a brand-new
  // account (no counter yet) through once.
  if (limits[kind] === 0) return { ok: false, message: PAUSED_MESSAGE };
  return (await using.increment(username, kind, limits[kind])) ? { ok: true } : { ok: false, message: MESSAGES[kind] };
}

export async function refund(
  username: string,
  role: AuthRole,
  kind: QuotaKind,
  using: UsageStore = defaultStore(),
): Promise<void> {
  if (!hasLimits(role)) return;
  await using.decrement(username, kind);
}
