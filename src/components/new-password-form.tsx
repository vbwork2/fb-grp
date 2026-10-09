"use client";

import { ActionButton, ActionForm } from "@/components/loading";

import { T } from "@/components/language-provider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon } from "@/components/icons";

export default function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const password = new FormData(event.currentTarget).get("password");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(result.error?.message ?? "Reset link is invalid or expired.");
        return;
      }
      router.push("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reset link is invalid or expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ActionForm className="form space-y-4" onSubmit={submit}>
      <div className="field">
        <label htmlFor="newPassword">
          <T>{"New password"}</T>
        </label>
        <input
          id="newPassword"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={1024}
          autoComplete="new-password"
          placeholder="••••••••••••"
        />
        <small>
          <T>{"At least 10 characters and include a number."}</T>
        </small>
      </div>

      {error && (
        <div className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </div>
      )}

      <ActionButton
        className="button primary w-full"
        disabled={token.length < 32 || busy}
        style={{ width: "100%" }}
      >
        <T>{busy ? "Updating…" : "Update password"}</T>
      </ActionButton>
    </ActionForm>
  );
}
