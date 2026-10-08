
import { T } from "@/components/language-provider";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { PairingPanel } from "@/components/workspace-panel";
import DeviceList from "@/components/device-list";
import ProfileSettings from "@/components/profile-settings";

export default async function SettingsPage() {
  const identity = await getIdentity(); if (!identity) return null;
  const connected = await db.select({ id: devices.id, name: devices.name, createdAt: devices.createdAt, lastSeenAt: devices.lastSeenAt, expiresAt: devices.expiresAt }).from(devices).where(and(eq(devices.workspaceId, identity.workspaceId), isNull(devices.revokedAt))).orderBy(desc(devices.createdAt));
  return <main className="content"><div className="page-head"><div><div className="eyebrow"><T>{"Workspace"}</T></div><h1><T>{"Settings"}</T></h1><p><T>{"Manage your account and connected browser devices."}</T></p></div></div><div className="panel"><div className="panel-head"><h2><T>{"Profile and security"}</T></h2><span className="muted">{identity.email}</span></div><ProfileSettings displayName={identity.name} /></div><PairingPanel /><div className="panel"><div className="panel-head"><h2><T>{"Connected devices"}</T></h2><span className="muted">{connected.length}<T>{" devices"}</T></span></div><DeviceList initialDevices={connected} /></div><div className="panel"><div className="panel-head"><h2><T>{"Security boundary"}</T></h2></div><div style={{ padding: 20 }} className="notice"><T>{"Groupflow never receives or stores Facebook passwords, cookies, browser sessions, or verification codes. Sign in to Facebook directly at facebook.com. Posting only happens when you click Publish to Facebook or publish directly on Facebook. Verify the result before confirming history."}</T></div></div></main>;
}

