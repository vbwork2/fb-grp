import { T, LocalizedInput } from "@/components/language-provider";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { GroupsPanel } from "@/components/workspace-panel";
import { SearchIcon } from "@/components/icons";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; category?: string; q?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) return null;

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 25;
  const conditions = [eq(groups.workspaceId, identity.workspaceId)];

  if (["ACTIVE", "PAUSED", "DISABLED"].includes(params.status ?? "")) {
    conditions.push(eq(groups.status, params.status as typeof groups.$inferSelect.status));
  }
  if (params.category?.trim()) {
    conditions.push(ilike(groups.category, params.category.trim()));
  }
  if (params.q?.trim()) {
    conditions.push(
      or(ilike(groups.name, `%${params.q.trim()}%`), ilike(groups.category, `%${params.q.trim()}%`))!
    );
  }
  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(groups)
      .where(where)
      .orderBy(desc(groups.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(groups).where(where),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const filterParams = new URLSearchParams();
  for (const key of ["status", "category", "q"] as const) {
    if (params[key]) filterParams.set(key, params[key]!);
  }

  function pageUrl(target: number) {
    const query = new URLSearchParams(filterParams);
    query.set("page", String(target));
    return `/groups?${query.toString()}`;
  }

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <T>{"Workspace"}</T>
          </div>
          <h1>
            <T>{"Groups"}</T>
          </h1>
          <p>
            <T>{"Manage the Facebook Groups you belong to."}</T>
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <SearchIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Find groups"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">
            {total} <T>{" matching groups"}</T>
          </span>
        </div>

        <form method="get" className="filters p-5 bg-slate-50/50 border-b border-slate-100">
          <label>
            <T>{"Search"}</T>
            <LocalizedInput
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Name or category"
            />
          </label>
          <label>
            <T>{"Status"}</T>
            <select name="status" defaultValue={params.status ?? ""}>
              <option value="">
                <T>{"All statuses"}</T>
              </option>
              {["ACTIVE", "PAUSED", "DISABLED"].map((status) => (
                <option value={status} key={status}>
                  <T>{status}</T>
                </option>
              ))}
            </select>
          </label>
          <label>
            <T>{"Category"}</T>
            <LocalizedInput
              name="category"
              defaultValue={params.category ?? ""}
              placeholder="Exact category"
            />
          </label>
          <button className="button small primary">
            <T>{"Filter"}</T>
          </button>
        </form>
      </div>

      <GroupsPanel initialGroups={items} />

      <div className="pagination">
        <span className="muted text-xs">
          <T>{"Page "}</T>
          <strong className="text-slate-800">{page}</strong>
          <T>{" of "}</T>
          <strong className="text-slate-800">{Math.max(1, Math.ceil(total / pageSize))}</strong>
        </span>
        <div className="buttons">
          {page > 1 && (
            <a className="button small" href={pageUrl(page - 1)}>
              <T>{"Previous"}</T>
            </a>
          )}
          {page * pageSize < total && (
            <a className="button small" href={pageUrl(page + 1)}>
              <T>{"Next"}</T>
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
