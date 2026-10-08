import { vietnamese } from "./messages";

export type Locale = "en" | "vi";
export const LOCALE_COOKIE = "groupflow_locale";

export function translate(text: string, locale: Locale): string {
  if (locale === "en") return text;
  const trimmed = text.trim();
  const match = vietnamese[trimmed];
  if (match) return text.replace(trimmed, match);
  const patterns: [RegExp, (...values: string[]) => string][] = [
    [/^Delete (.+)\?$/, (name) => `Xóa ${name}?`],
    [/^Select (.+)$/, (name) => `Chọn ${name}`],
    [/^View (.+)$/, (name) => `Xem ${name}`],
    [/^Choose an image up to (\d+) MB\.$/, (size) => `Chọn ảnh tối đa ${size} MB.`],
    [/^Total (\d+); imported (\d+); duplicates (\d+); invalid (\d+)\.$/, (total, imported, duplicates, invalid) => `Tổng ${total}; đã nhập ${imported}; trùng ${duplicates}; không hợp lệ ${invalid}.`],
    [/^(\d+) groups disabled\.$/, (count) => `Đã vô hiệu hóa ${count} nhóm.`],
    [/^Code expires at (.+)\.$/, (time) => `Mã hết hạn lúc ${time}.`],
    [/^(\d+) failed jobs returned to the queue\.$/, (count) => `Đã đưa ${count} việc thất bại trở lại hàng đợi.`],
    [/^Campaign (running|paused|cancelled|completed|ready)\.$/, (status) => `Chiến dịch: ${translate(status.toUpperCase(), locale).toLowerCase()}.`],
    [/^The server returned an invalid response \(HTTP (\d+)\)\. Check the terminal running npm run dev\.$/, (status) => `Máy chủ trả về phản hồi không hợp lệ (HTTP ${status}). Kiểm tra cửa sổ đang chạy npm run dev.`],
    [/^Upload .+ up to (\d+) MB\.$/, (size) => `Tải ảnh JPG, PNG hoặc WebP hợp lệ, tối đa ${size} MB.`],
  ];
  for (const [pattern, format] of patterns) {
    const values = pattern.exec(trimmed);
    if (values) return text.replace(trimmed, format(...values.slice(1)));
  }
  return text;
}

export function browserLocale(): Locale {
  if (typeof document === "undefined") return "en";
  return document.cookie.split(";").some((item) => item.trim() === `${LOCALE_COOKIE}=vi`) ? "vi" : "en";
}

export function translateDialog(text: string): string {
  return translate(text, browserLocale());
}
