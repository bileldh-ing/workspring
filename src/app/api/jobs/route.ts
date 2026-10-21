import { getDb } from "@/db/client";
import { jobSearchSchema, parseOrThrow } from "@/domain/validation";
import { api, jsonBody } from "@/lib/api";
import { createJob, searchJobs } from "@/server/services/jobs";

/** Public search over open jobs: ?q=&category=&skill=&type=&level=&minBudget=&sort=&page= */
export const GET = api(async ({ req }) => searchJobs(getDb(), parseOrThrow(jobSearchSchema, Object.fromEntries(req.nextUrl.searchParams))), { auth: false });

export const POST = api(async ({ req, actor }) => createJob(getDb(), actor!, await jsonBody(req)));
