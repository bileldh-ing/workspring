import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adminCan, requireAdmin } from "@/domain/admin";
import { agencyCan, canRemove } from "@/domain/agency";
import { checkUpload, sanitizeFileName } from "@/domain/files";
import { billableMinor, roundMinutes, weekRange, weekStartOf, withinWeeklyLimit } from "@/domain/hourly";
import { averageRating, revealTime, reviewWindowOpen } from "@/domain/reviews";
import { canTransition, disputeMachine, interviewMachine, milestoneMachine, orderMachine, serviceMachine, timesheetMachine } from "@/domain/state-machines";
import { signV4 } from "@/server/storage/s3";
import { signLiveKitToken } from "@/server/video/livekit";

describe("hourly math", () => {
  it("computes Monday week starts in UTC", () => {
    expect(weekStartOf(new Date("2026-10-22T10:00:00Z"))).toBe("2026-10-19");
    expect(weekStartOf(new Date("2026-10-19T00:00:00Z"))).toBe("2026-10-19");
    expect(weekStartOf(new Date("2026-10-25T23:59:59Z"))).toBe("2026-10-19");
    expect(() => weekRange("2026-10-20")).toThrow(/Monday/);
    expect(weekRange("2026-10-19").end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
  it("rounds sessions to whole minutes with a 1-minute floor", () => {
    expect(roundMinutes(10_000)).toBe(1);
    expect(roundMinutes(89_999)).toBe(1);
    expect(roundMinutes(90_000)).toBe(2);
    expect(roundMinutes(25 * 60_000)).toBe(25);
    expect(() => roundMinutes(-1)).toThrow();
  });
  it("bills minutes at the hourly rate with half-up rounding", () => {
    expect(billableMinor(60, 4000)).toBe(4000);
    expect(billableMinor(90, 4000)).toBe(6000);
    expect(billableMinor(1, 4500)).toBe(75);
    expect(billableMinor(1, 1)).toBe(0);
    expect(billableMinor(1, 30)).toBe(1);
  });
  it("checks weekly limits", () => {
    expect(withinWeeklyLimit(50, 10, 60)).toBe(true);
    expect(withinWeeklyLimit(50, 11, 60)).toBe(false);
    expect(withinWeeklyLimit(5000, 10, null)).toBe(true);
  });
});

describe("new state machines", () => {
  it("only reaches provider-confirmed states from pending states", () => {
    expect(canTransition(timesheetMachine, "submitted", "paid")).toBe(false);
    expect(canTransition(timesheetMachine, "payment_pending", "paid")).toBe(true);
    expect(canTransition(orderMachine, "pending_payment", "in_progress")).toBe(false);
    expect(canTransition(orderMachine, "pending_payment", "requirements_pending")).toBe(true);
    expect(canTransition(orderMachine, "delivered", "completed")).toBe(false);
    expect(canTransition(milestoneMachine, "disputed", "refunded")).toBe(false);
    expect(canTransition(milestoneMachine, "refund_pending", "refunded")).toBe(true);
    expect(canTransition(milestoneMachine, "approved", "disputed")).toBe(false);
  });
  it("keeps terminal states terminal", () => {
    expect(serviceMachine.archived).toHaveLength(0);
    expect(disputeMachine.resolved_refund).toHaveLength(0);
    expect(interviewMachine.completed).toHaveLength(0);
    expect(orderMachine.completed).toHaveLength(0);
    expect(canTransition(serviceMachine, "draft", "published")).toBe(false);
  });
});

describe("permission matrices", () => {
  it("separates admin roles", () => {
    expect(adminCan(["support"], "support.handle")).toBe(true);
    expect(adminCan(["support"], "users.suspend")).toBe(false);
    expect(adminCan(["finance"], "disputes.resolve")).toBe(true);
    expect(adminCan(["moderator"], "payments.read")).toBe(false);
    expect(() => requireAdmin([], "users.read")).toThrow(/Not found/);
    expect(() => requireAdmin(["support"], "roles.grant")).toThrow(/roles.grant/);
  });
  it("limits agency roles and protects the owner", () => {
    expect(agencyCan("member", "invite")).toBe(false);
    expect(agencyCan("admin", "invite")).toBe(true);
    expect(agencyCan("admin", "change_role")).toBe(false);
    expect(canRemove("admin", "member", false)).toBe(true);
    expect(canRemove("admin", "admin", false)).toBe(false);
    expect(canRemove("owner", "admin", false)).toBe(true);
    expect(canRemove("owner", "owner", true)).toBe(false);
    expect(canRemove("member", "member", true)).toBe(true);
  });
});

describe("upload policy", () => {
  const pdfHead = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  it("allows listed types whose bytes match", () => {
    expect(checkUpload("Brief.PDF", 100, pdfHead)).toMatchObject({ ok: true, ext: "pdf", mime: "application/pdf" });
    expect(checkUpload("notes.txt", 10, new TextEncoder().encode("hello"))).toMatchObject({ ok: true });
  });
  it("rejects unknown types, spoofed contents, binaries in text, empty and oversized files", () => {
    expect(checkUpload("run.exe", 10, pdfHead).ok).toBe(false);
    expect(checkUpload("image.png", 10, pdfHead).ok).toBe(false);
    expect(checkUpload("a.txt", 10, new Uint8Array([104, 0, 105])).ok).toBe(false);
    expect(checkUpload("a.pdf", 0, pdfHead).ok).toBe(false);
    expect(checkUpload("a.pdf", 11 * 1024 * 1024, pdfHead).ok).toBe(false);
    expect(checkUpload("noext", 10, pdfHead).ok).toBe(false);
  });
  it("sanitizes names (no paths, no markup characters)", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\x\\évil<script>.pdf")).toBe("évil_script_.pdf");
    expect(sanitizeFileName("...")).toBe("file");
  });
});

describe("reviews policy", () => {
  const done = new Date("2026-10-01T00:00:00Z");
  it("reveals when both submit or after 14 days", () => {
    expect(revealTime({ completedAt: done, bothSubmitted: false, now: new Date("2026-10-05T00:00:00Z") })).toBeNull();
    expect(revealTime({ completedAt: done, bothSubmitted: false, now: new Date("2026-10-20T00:00:00Z") })?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(revealTime({ completedAt: done, bothSubmitted: true, now: new Date("2026-10-02T00:00:00Z") })).not.toBeNull();
    expect(reviewWindowOpen(done, new Date("2026-10-16T00:00:00Z"))).toBe(false);
    expect(averageRating([5, 4, 4])).toEqual({ average: 4.3, count: 3 });
    expect(averageRating([])).toEqual({ average: null, count: 0 });
  });
});

describe("provider token signing", () => {
  it("signs LiveKit HS256 tokens with a scoped room grant and expiry", () => {
    const t = signLiveKitToken({ url: "wss://x", apiKey: "key", apiSecret: "secret" }, { identity: "u1", name: "U", room: "r1", ttlSeconds: 600, now: 1_000_000 });
    const [h, p, s] = t.split(".");
    expect(createHmac("sha256", "secret").update(`${h}.${p}`).digest("base64url")).toBe(s);
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toMatchObject({ iss: "key", sub: "u1", exp: 1_000_600, video: { room: "r1", roomJoin: true, roomRecord: false } });
  });
  it("produces deterministic SigV4 authorization headers", () => {
    const args = { method: "GET", url: new URL("https://s3.eu-west-1.amazonaws.com/bucket/key"), region: "eu-west-1", accessKeyId: "AKID", secretAccessKey: "SECRET", body: "", now: new Date("2026-01-01T00:00:00Z") };
    const a = signV4(args);
    expect(a.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20260101\/eu-west-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(signV4(args).authorization).toBe(a.authorization);
    expect(a["x-amz-content-sha256"]).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
