import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { listMyProposals, submitProposal } from "@/server/services/proposals";

export const GET = api(async ({ actor }) => listMyProposals(getDb(), actor!));
export const POST = api(async ({ req, actor }) => submitProposal(getDb(), actor!, await jsonBody(req)));
