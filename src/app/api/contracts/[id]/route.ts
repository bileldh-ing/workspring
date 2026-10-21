import { getDb } from "@/db/client";
import { api } from "@/lib/api";
import { getWorkroom } from "@/server/services/contracts";

export const GET = api<{ id: string }>(async ({ params, actor }) => getWorkroom(getDb(), actor!, params.id));
