import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { createOffer, listMyOffers } from "@/server/services/contracts";

export const GET = api(async ({ actor }) => listMyOffers(getDb(), actor!));
export const POST = api(async ({ req, actor }) => createOffer(getDb(), actor!, await jsonBody(req)));
