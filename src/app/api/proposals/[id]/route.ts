import { getDb } from "@/db/client";
import { api } from "@/lib/api";
import { getProposal } from "@/server/services/proposals";

export const GET = api<{ id: string }>(async ({ params, actor }) => getProposal(getDb(), actor!, params.id));
