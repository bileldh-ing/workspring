import { getDb } from "@/db/client";
import { AppError } from "@/domain/errors";
import { api } from "@/lib/api";
import { acceptOffer, declineOffer, withdrawOffer } from "@/server/services/contracts";

export const POST = api<{ id: string; action: string }>(async ({ params, actor }) => {
  const db = getDb();
  switch (params.action) {
    case "accept":
      return { contract: await acceptOffer(db, actor!, params.id) };
    case "decline":
      await declineOffer(db, actor!, params.id);
      return { ok: true };
    case "withdraw":
      await withdrawOffer(db, actor!, params.id);
      return { ok: true };
    default:
      throw new AppError("NOT_FOUND", "Unknown action");
  }
});
