import { describe, expect, it } from "vitest";
import { hashPassword, validatePassword, verifyPassword } from "../src/lib/security/password";
import { assertQueueTransition } from "../src/lib/services/queue-state-machine";
import { buildQueuePlan } from "../src/lib/services/queue-plan";
import { isFacebookGroupUrl, normalizeFacebookGroupUrl } from "../src/lib/validators/facebook";
import { validateImageUpload } from "../src/lib/validators/media";
import { createOpaqueToken, hashOpaqueToken } from "../src/lib/security/tokens";

describe("password security", () => {
  it("requires a long password with letters and numbers", () => {
    expect(validatePassword("short1")).toBe(false);
    expect(validatePassword("allletterslong")).toBe(false);
    expect(validatePassword("StrongPass123")).toBe(true);
  });

  it("stores a salted scrypt digest and verifies only the matching password", async () => {
    const digest = await hashPassword("StrongPass123");
    expect(digest).not.toContain("StrongPass123");
    expect(await verifyPassword("StrongPass123", digest)).toBe(true);
    expect(await verifyPassword("WrongPass123", digest)).toBe(false);
  });
});

describe("Facebook Group URL validation", () => {
  it("accepts only Facebook Group URLs and canonicalizes equivalent hosts and trailing slashes", () => {
    expect(isFacebookGroupUrl("https://m.facebook.com/groups/sample" )).toBe(true);
    expect(isFacebookGroupUrl("https://facebook.com/profile.php?id=1")).toBe(false);
    expect(isFacebookGroupUrl("https://not-facebook.com/groups/sample")).toBe(false);
    expect(normalizeFacebookGroupUrl("https://m.facebook.com/groups/sample?ref=share")).toBe("https://www.facebook.com/groups/sample/");
  });
});

describe("media upload validation", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  it("accepts allowed signature, MIME, extension, and size combinations", () => {
    expect(validateImageUpload(png, "image/png", "sample.png", png.length, 1024)).toBe(true);
  });
  it("rejects oversized, forged MIME, and fake extensions", () => {
    expect(validateImageUpload(png, "image/png", "sample.png", 2048, 1024)).toBe(false);
    expect(validateImageUpload(png, "image/jpeg", "sample.jpg", png.length, 1024)).toBe(false);
    expect(validateImageUpload(png, "image/png", "sample.jpg", png.length, 1024)).toBe(false);
  });
});

describe("opaque device tokens", () => {
  it("creates high-entropy tokens and stores only a one-way digest", () => {
    const token = createOpaqueToken();
    const digest = hashOpaqueToken(token);
    expect(token).toHaveLength(43);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
    expect(hashOpaqueToken(token)).toBe(digest);
  });
});

describe("queue state machine", () => {
  it("allows the manual posting flow", () => {
    expect(() => assertQueueTransition("READY", "OPENED")).not.toThrow();
    expect(() => assertQueueTransition("OPENED", "AWAITING_CONFIRMATION")).not.toThrow();
    expect(() => assertQueueTransition("AWAITING_CONFIRMATION", "POSTED")).not.toThrow();
  });

  it("rejects invalid transitions and terminal status changes", () => {
    expect(() => assertQueueTransition("PENDING", "POSTED")).toThrow(/Invalid queue transition/);
    expect(() => assertQueueTransition("POSTED", "READY")).toThrow(/Invalid queue transition/);
  });
});

describe("queue planning", () => {
  it("schedules groups in order and assigns round-robin content variants", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const plan = buildQueuePlan({ workspaceId: "workspace", campaignId: "campaign", groups: [1, 2, 3, 4].map((position) => ({ groupId: `group-${position}`, position })), scheduledStartAt: null, minIntervalSeconds: 10, maxIntervalSeconds: 10, strategy: "ROUND_ROBIN", variantIds: ["variant-a", "variant-b"], now });
    expect(plan.map((job) => job.variantId)).toEqual(["variant-a", "variant-b", "variant-a", "variant-b"]);
    expect(plan.map((job) => job.status)).toEqual(["READY", "PENDING", "PENDING", "PENDING"]);
    expect(plan.map((job) => job.scheduledAt.getTime() - now.getTime())).toEqual([0, 10_000, 20_000, 30_000]);
  });

  it("requires variants for round robin and honors a future schedule start", () => {
    const future = new Date("2026-01-01T01:00:00.000Z");
    expect(() => buildQueuePlan({ workspaceId: "workspace", campaignId: "campaign", groups: [], scheduledStartAt: null, minIntervalSeconds: 1, maxIntervalSeconds: 2, strategy: "ROUND_ROBIN", variantIds: [] })).toThrow(/variant/);
    const plan = buildQueuePlan({ workspaceId: "workspace", campaignId: "campaign", groups: [{ groupId: "group-1", position: 0 }], scheduledStartAt: future, minIntervalSeconds: 1, maxIntervalSeconds: 2, strategy: "PRIMARY_ONLY", variantIds: [], now: new Date("2026-01-01T00:00:00.000Z") });
    expect(plan[0].scheduledAt).toEqual(future);
  });
});
