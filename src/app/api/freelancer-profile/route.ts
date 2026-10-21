import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { getMyProfile, saveProfile } from "@/server/services/profiles";

export const GET = api(async ({ actor }) => getMyProfile(getDb(), actor!));
/** Create or update the caller's freelancer profile (new profiles are drafts). */
export const PUT = api(async ({ req, actor }) => {
  await saveProfile(getDb(), actor!, await jsonBody(req));
  return getMyProfile(getDb(), actor!);
});
