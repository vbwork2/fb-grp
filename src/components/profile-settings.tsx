"use client";
import { T } from "@/components/language-provider";


import { useState } from "react";

export default function ProfileSettings({ displayName }: { displayName: string }) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to save settings.");
      setSuccess("Profile settings saved. Sign in again if you changed your password.");
      if (event.currentTarget instanceof HTMLFormElement) event.currentTarget.elements.namedItem("currentPassword");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save settings."); }
  }
  return <form className="form" style={{ padding: 20 }} onSubmit={submit}><div className="field"><label htmlFor="displayName"><T>{"Display name"}</T></label><input id="displayName" name="displayName" defaultValue={displayName} required maxLength={120} /></div><div className="two-col"><div className="field"><label htmlFor="currentPassword"><T>{"Current password"}</T></label><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" /></div><div className="field"><label htmlFor="newPassword"><T>{"New password"}</T></label><input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} /><small><T>{"Leave blank to keep your current password."}</T></small></div></div>{error && <p className="error" role="alert"><T>{error}</T></p>}{success && <div className="notice" role="status"><T>{success}</T></div>}<button className="button primary" style={{ justifySelf: "start" }}><T>{"Save profile"}</T></button></form>;
}
