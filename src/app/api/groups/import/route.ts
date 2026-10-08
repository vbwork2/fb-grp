import { parse } from "csv-parse/sync";
import { z } from "zod";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { isFacebookGroupUrl, normalizeFacebookGroupUrl } from "@/lib/validators/facebook";

const rowSchema = z.object({ name: z.string().trim().min(1).max(160), url: z.string().trim().max(2048), category: z.string().trim().max(80).optional().default("") });

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size > 2 * 1024 * 1024) return jsonError("INVALID_FILE", "Choose a CSV file up to 2 MB.");
  let rows: Record<string, unknown>[];
  try { rows = parse(await file.text(), { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: false, max_record_size: 10_000 }) as Record<string, unknown>[]; }
  catch { return jsonError("INVALID_CSV", "The CSV could not be parsed. Check its headers and quoting."); }
  if (rows.length > 5000) return jsonError("TOO_MANY_ROWS", "Import up to 5,000 groups at a time.");
  const valid = rows.map((row) => rowSchema.safeParse({ name: row.name, url: row.url, category: row.category })).filter((result) => result.success).map((result) => result.data).filter((row) => isFacebookGroupUrl(row.url));
  const unique = new Map(valid.map((row) => [normalizeFacebookGroupUrl(row.url), { ...row, url: normalizeFacebookGroupUrl(row.url) }]));
  const values = [...unique.values()];
  const inserted = values.length ? await db.insert(groups).values(values.map((row) => ({ workspaceId: identity.workspaceId, createdBy: identity.userId, name: row.name, facebookUrl: row.url, category: row.category || null }))).onConflictDoNothing({ target: [groups.workspaceId, groups.facebookUrl] }).returning() : [];
  return jsonSuccess({ total: rows.length, imported: inserted.length, duplicate: valid.length - inserted.length, invalid: rows.length - valid.length, items: inserted });
}
