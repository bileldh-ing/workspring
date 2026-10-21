import { api } from "@/lib/api";

export const GET = api(async ({ actor }) => actor);
