import { getDb } from "@/db/client";
import { api } from "@/lib/api";
import { withdrawProposal } from "@/server/services/proposals";

export const POST = api<{ id: string }>(async ({ params, actor }) => {
  await withdrawProposal(getDb(), actor!, params.id);
  return { ok: true };
});
