import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { getOwnedJob, updateJob } from "@/server/services/jobs";

export const GET = api<{ id: string }>(async ({ params, actor }) => getOwnedJob(getDb(), actor!, params.id));
export const PATCH = api<{ id: string }>(async ({ req, params, actor }) => {
  await updateJob(getDb(), actor!, params.id, await jsonBody(req));
  return getOwnedJob(getDb(), actor!, params.id);
});
