import { T } from "@/components/language-provider";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { PairingPanel } from "@/components/workspace-panel";
import DeviceList from "@/components/device-list";
import ProfileSettings from "@/components/profile-settings";
import { SettingsIcon, ShieldIcon, DeviceIcon } from "@/components/icons";

export default async function SettingsPage() {
  const identity = await getIdentity();
  if (!identity) return null;

  const connected = await db
    .select({
      id: devices.id,
      name: devices.name,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
      expiresAt: devices.expiresAt,
    })
    .from(devices)
    .where(and(eq(devices.workspaceId, identity.workspaceId), isNull(devices.revokedAt)))
    .orderBy(desc(devices.createdAt));

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <T>{"Workspace"}</T>
          </div>
          <h1>
            <T>{"Settings"}</T>
          </h1>
          <p>
            <T>{"Manage your account and connected browser devices."}</T>
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Profile and security"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">{identity.email}</span>
        </div>
        <ProfileSettings displayName={identity.name} />
      </div>

      <PairingPanel />

      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <DeviceIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Connected devices"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">
            {connected.length}
            <T>{" devices"}</T>
          </span>
        </div>
        <DeviceList initialDevices={connected} />
      </div>

      <div className="panel border-emerald-200">
        <div className="panel-head bg-emerald-50/50">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-4 h-4 text-emerald-600" />
            <h2>
              <T>{"Security boundary"}</T>
            </h2>
          </div>
        </div>
        <div className="p-6">
          <div className="notice flex items-start gap-3">
            <ShieldIcon className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
            <p className="m-0 leading-relaxed text-sm text-emerald-900">
              <T>
                {
                  "Groupflow never receives or stores Facebook passwords, cookies, browser sessions, or verification codes. Sign in to Facebook directly at facebook.com. Posting only happens when you click Publish to Facebook or publish directly on Facebook. Verify the result before confirming history."
                }
              </T>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
