import { getDb } from "@/db/client";
import { api } from "@/lib/api";
import { listJobProposals } from "@/server/services/proposals";

export const GET = api<{ id: string }>(async ({ params, actor }) => listJobProposals(getDb(), actor!, params.id));
