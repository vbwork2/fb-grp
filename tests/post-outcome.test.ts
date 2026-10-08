import { describe, expect, it } from "vitest";
import { classifyPostSignals } from "../extension/src/content/post-outcome";
describe("Facebook result signals", () => {
  it.each([
    [[], "UNKNOWN"],
    [["Your post was published."], "PUBLISHED_CONFIRMED"],
    [["Bài viết của bạn đã được đăng."], "PUBLISHED_CONFIRMED"],
    [["Your post was published.", "Pending admin approval"], "UNKNOWN"],
    [["Your post was published. Read this feed post"], "UNKNOWN"],
    [["Submitted for approval"], "PENDING_APPROVAL"],
    [["Could not publish"], "POST_FAILED"],
    [["Confirm your identity"], "CHECKPOINT_OR_LOGIN_REQUIRED"],
  ])("classifies %j conservatively", (signals, expected) => {
    expect(classifyPostSignals(signals as string[])).toBe(expected);
  });
});
