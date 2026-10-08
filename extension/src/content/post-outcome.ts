export type PostOutcome = "PUBLISHED_CONFIRMED" | "PENDING_APPROVAL" | "UNKNOWN" | "POST_FAILED" | "CHECKPOINT_OR_LOGIN_REQUIRED";

// Conflicting signals always require review rather than optimistic publication.
export function classifyPostSignals(signals: string[]): PostOutcome {
  const outcomes = new Set<PostOutcome>();
  for (const text of signals) {
    if (/log in to continue|checkpoint|confirm your identity|đăng nhập để tiếp tục|xác minh danh tính/i.test(text)) outcomes.add("CHECKPOINT_OR_LOGIN_REQUIRED");
    if (/submitted for approval|pending admin approval|chờ (quản trị viên )?(phê duyệt|duyệt)/i.test(text)) outcomes.add("PENDING_APPROVAL");
    if (/could not publish|couldn't post|post failed|không thể đăng|đăng bài thất bại/i.test(text)) outcomes.add("POST_FAILED");
    if (/^your post (has been |was )?(published|posted)[.!]?$/i.test(text) || /^bài viết (của bạn )?(đã )?(được đăng|đã đăng)[.!]?$/i.test(text)) outcomes.add("PUBLISHED_CONFIRMED");
  }
  return outcomes.size === 1 ? [...outcomes][0] : "UNKNOWN";
}
