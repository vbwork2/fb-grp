export function isHttpUrl(value: string): boolean {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol); } catch { return false; }
}

export function isFacebookPostUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname); } catch { return false; }
}
