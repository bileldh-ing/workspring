import "server-only";
import { isAppError } from "@/domain/errors";
import type { ActionState } from "./action-state";

/**
 * Runs a server action body, mapping domain errors to form state. Anything else (including
 * Next.js redirect/notFound control-flow errors) is rethrown untouched.
 */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (isAppError(e)) return { error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
export const strs = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
