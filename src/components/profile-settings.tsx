"use client";

import { T } from "@/components/language-provider";
import { useState } from "react";
import { AlertCircleIcon, CheckIcon } from "@/components/icons";

export default function ProfileSettings({ displayName }: { displayName: string }) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to save settings.");
      setSuccess("Profile settings saved. Sign in again if you changed your password.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form p-6" onSubmit={submit}>
      <div className="field">
        <label htmlFor="displayName">
          <T>{"Display name"}</T>
        </label>
        <input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          required
          maxLength={120}
          placeholder="Your full name"
        />
      </div>

      <div className="two-col">
        <div className="field">
          <label htmlFor="currentPassword">
            <T>{"Current password"}</T>
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
          />
        </div>
        <div className="field">
          <label htmlFor="newPassword">
            <T>{"New password"}</T>
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            placeholder="At least 10 characters"
          />
          <small>
            <T>{"Leave blank to keep your current password."}</T>
          </small>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </p>
      )}

      {success && (
        <div className="notice" role="status">
          <CheckIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{success}</T></span>
        </div>
      )}

      <div className="pt-2">
        <button
          className="button primary"
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          <T>{busy ? "Saving…" : "Save profile"}</T>
        </button>
      </div>
    </form>
  );
}
