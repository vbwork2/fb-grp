
import { T } from "@/components/language-provider";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contents } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { ContentPanel } from "@/components/workspace-panel";

export default async function ContentPage() {
  const identity = await getIdentity(); if (!identity) return null;
  const items = await db.select().from(contents).where(eq(contents.workspaceId, identity.workspaceId)).orderBy(desc(contents.updatedAt)).limit(100);
  return <main className="content"><div className="page-head"><div><div className="eyebrow"><T>{"Library"}</T></div><h1><T>{"Content"}</T></h1><p><T>{"Save captions for review before you post."}</T></p></div></div><ContentPanel initialContents={items} /></main>;
}
