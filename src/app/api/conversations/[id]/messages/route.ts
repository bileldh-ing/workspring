import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { listMessages, postMessage } from "@/server/services/messaging";

export const GET = api<{ id: string }>(async ({ params, actor }) => listMessages(getDb(), actor!, params.id));
export const POST = api<{ id: string }>(async ({ req, params, actor }) => postMessage(getDb(), actor!, params.id, await jsonBody(req)));
