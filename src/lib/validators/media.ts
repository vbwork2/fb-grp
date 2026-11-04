const allowedExtensions: Record<string, string[]> = { "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"], "application/pdf": ["pdf"] };
export const MEDIA_UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";

export function isSupportedMediaFile(mimeType: string, filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return allowedExtensions[mimeType]?.includes(extension) === true;
}

export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function validateImageUpload(bytes: Uint8Array, mimeType: string, filename: string, size: number, maxBytes: number): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const detected = detectImageMime(bytes);
  return size > 0 && size <= maxBytes && detected !== null && detected === mimeType && allowedExtensions[mimeType]?.includes(extension) === true;
}

export function validateMediaUpload(bytes: Uint8Array, mimeType: string, filename: string, size: number, maxBytes: number): boolean {
  if (mimeType !== "application/pdf") return validateImageUpload(bytes, mimeType, filename, size, maxBytes);
  if (size <= 0 || size > maxBytes || bytes.byteLength !== size || !isSupportedMediaFile(mimeType, filename)) return false;
  // Require a PDF version header and end marker rather than trusting the filename.
  const header = new TextDecoder().decode(bytes.slice(0, 9));
  const tail = new TextDecoder().decode(bytes.slice(-1024));
  return /^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(header) && /%%EOF[\s\0]*$/.test(tail);
}

export function mediaContentDisposition(filename: string, download: boolean): string {
  const safeName = Array.from(filename).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127 && character !== "/" && character !== "\\").join("").toWellFormed();
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? "attachment" : "inline"}; filename="document.pdf"; filename*=UTF-8''${encoded}`;
}
