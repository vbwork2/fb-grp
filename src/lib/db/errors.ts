export function databaseErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("code" in current && typeof current.code === "string") return current.code;
    if (!("cause" in current)) return undefined;
    current = current.cause;
  }
  return undefined;
}
