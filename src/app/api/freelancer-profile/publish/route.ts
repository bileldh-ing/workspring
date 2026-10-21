import { z } from "zod";
import { getDb } from "@/db/client";
import { parseOrThrow } from "@/domain/validation";
import { api, jsonBody } from "@/lib/api";
import { setProfileVisibility } from "@/server/services/profiles";

const body = z.object({ publish: z.boolean() });
export const POST = api(async ({ req, actor }) => {
  const { publish } = parseOrThrow(body, await jsonBody(req));
  await setProfileVisibility(getDb(), actor!, publish);
  return { status: publish ? "published" : "hidden" };
});
