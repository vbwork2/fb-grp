function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export const config = {
  pairingCodeTtlSeconds: positiveInteger(process.env.PAIRING_CODE_TTL_SECONDS, 300, 3600),
  deviceTokenTtlDays: positiveInteger(process.env.DEVICE_TOKEN_TTL_DAYS, 90, 365),
  queueClaimTtlMinutes: positiveInteger(process.env.QUEUE_CLAIM_TTL_MINUTES, 30, 24 * 60),
  maxUploadSizeBytes: Math.min(positiveInteger(process.env.MAX_UPLOAD_SIZE_MB, 10, 25), process.env.NODE_ENV === "production" ? 4 : 25) * 1024 * 1024,
};
