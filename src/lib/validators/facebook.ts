export function isFacebookGroupUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) && /^\/groups\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function normalizeFacebookGroupUrl(value: string): string {
  const url = new URL(value);
  const groupPath = url.pathname.replace(/\/+$/, "");
  return `https://www.facebook.com${groupPath}/`;
}
