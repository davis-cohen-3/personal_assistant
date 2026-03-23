import { z } from "zod";
import {
  getBucket,
  getBucketTemplate,
  insertBuckets,
  listBuckets,
  listBucketsByIds,
  markAllForRebucket,
  createBucket as queryCreateBucket,
  getUnbucketedThreads as queryGetUnbucketedThreads,
  upsertThreadBucket,
  upsertThreadBuckets,
} from "./db/queries.js";
import { AppError } from "./exceptions.js";

const BATCH_SIZE = 25;

const BucketDefinitionSchema = z.array(
  z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    sort_order: z.number().int().min(0),
  }),
);

export async function applyBucketTemplate(userId: string, templateId: string) {
  const template = await getBucketTemplate(templateId);
  if (!template) {
    throw new AppError(`Bucket template not found: ${templateId}`, 404, { userFacing: true });
  }

  const existing = await listBuckets(userId);
  if (existing.length > 0) {
    throw new AppError(
      "Buckets already exist — delete all buckets before applying a template",
      409,
      { userFacing: true },
    );
  }

  const items = BucketDefinitionSchema.parse(template.buckets);
  return insertBuckets(userId, items);
}

export async function createBucket(userId: string, name: string, description: string) {
  const bucket = await queryCreateBucket(userId, name, description);
  await markAllForRebucket(userId);
  return bucket;
}

export async function assignThread(
  userId: string,
  gmailThreadId: string,
  bucketId: string,
  subject?: string,
  snippet?: string,
) {
  const bucket = await getBucket(userId, bucketId);
  if (!bucket) {
    throw new AppError(`Bucket not found: ${bucketId}`, 404, { userFacing: true });
  }
  return upsertThreadBucket(userId, gmailThreadId, bucketId, subject, snippet);
}

export async function assignThreadsBatch(
  userId: string,
  assignments: Array<{
    gmailThreadId: string;
    bucketId: string;
    subject?: string;
    snippet?: string;
  }>,
) {
  if (assignments.length === 0) return [];
  if (assignments.length > BATCH_SIZE) {
    throw new AppError(`Batch size ${assignments.length} exceeds limit of ${BATCH_SIZE}`, 400, {
      userFacing: true,
    });
  }

  const bucketIds = [...new Set(assignments.map((a) => a.bucketId))];
  const userBuckets = await listBucketsByIds(userId, bucketIds);
  if (userBuckets.length !== bucketIds.length) {
    throw new AppError("One or more buckets not found", 404, { userFacing: true });
  }

  return upsertThreadBuckets(userId, assignments);
}

export async function getUnbucketedThreads(userId: string) {
  return queryGetUnbucketedThreads(userId, BATCH_SIZE);
}
