import { getDb } from "@/db/client";
import { AppError } from "@/domain/errors";
import { api, jsonBody } from "@/lib/api";
import { approveMilestone, deliverMilestone, fundMilestone, requestRelease, requestRevision } from "@/server/services/contracts";

export const POST = api<{ id: string; action: string }>(async ({ req, params, actor }) => {
  const db = getDb();
  switch (params.action) {
    case "fund":
      return fundMilestone(db, actor!, params.id);
    case "deliver":
      return deliverMilestone(db, actor!, params.id, await jsonBody(req));
    case "request-revision":
      await requestRevision(db, actor!, params.id, await jsonBody(req));
      return { ok: true };
    case "approve":
      return approveMilestone(db, actor!, params.id);
    case "release":
      return requestRelease(db, actor!, params.id);
    default:
      throw new AppError("NOT_FOUND", "Unknown action");
  }
});
