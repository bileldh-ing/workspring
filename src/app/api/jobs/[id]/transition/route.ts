import { z } from "zod";
import { getDb } from "@/db/client";
import { parseOrThrow } from "@/domain/validation";
import { api, jsonBody } from "@/lib/api";
import { transitionJob } from "@/server/services/jobs";

const body = z.object({ to: z.enum(["open", "paused", "closed"]) });
export const POST = api<{ id: string }>(async ({ req, params, actor }) => transitionJob(getDb(), actor!, params.id, parseOrThrow(body, await jsonBody(req)).to));
