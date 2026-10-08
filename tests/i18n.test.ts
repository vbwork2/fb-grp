import { describe, expect, it } from "vitest";
import { translate } from "../src/lib/i18n";

describe("application translation", () => {
  it("keeps English labels unchanged", () => {
    expect(translate("Campaigns", "en")).toBe("Campaigns");
  });
  it("translates labels, states and errors while preserving spacing", () => {
    expect(translate("Campaigns", "vi")).toBe("Chiến dịch");
    expect(translate("PAUSED", "vi")).toBe("Tạm dừng");
    expect(translate(" selected", "vi")).toBe(" đã chọn");
    expect(translate("Email or password is incorrect.", "vi")).toBe("Email hoặc mật khẩu không đúng.");
  });
  it("preserves dynamic values in feedback and confirmations", () => {
    expect(translate("Delete My Group?", "vi")).toBe("Xóa My Group?");
    expect(translate("Total 4; imported 2; duplicates 1; invalid 1.", "vi")).toBe("Tổng 4; đã nhập 2; trùng 1; không hợp lệ 1.");
    expect(translate("Choose an image up to 4 MB.", "vi")).toBe("Chọn ảnh tối đa 4 MB.");
    expect(translate("Campaign running.", "vi")).toBe("Chiến dịch: đang chạy.");
  });
  it("leaves unknown text and links unchanged", () => {
    expect(translate("My original caption", "vi")).toBe("My original caption");
    expect(translate("https://example.test/?status=READY", "vi")).toBe("https://example.test/?status=READY");
  });
});
