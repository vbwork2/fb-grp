"use client";

import { ActionButton, ActionForm } from "@/components/loading";

import { T } from "@/components/language-provider";
import { useState } from "react";
import { AlertCircleIcon, CheckIcon } from "@/components/icons";

export default function PasswordResetRequestForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { error?: { message: string }; data?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to request a password reset.");
      setMessage(result.data?.message ?? "If the account exists, we will send a reset link.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request a password reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ActionForm className="form space-y-4" onSubmit={submit}>
      <div className="field">
        <label htmlFor="resetEmail">
          <T>{"Email"}</T>
        </label>
        <input
          id="resetEmail"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@example.com"
        />
      </div>

      {message && (
        <div className="notice" role="status">
          <CheckIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{message}</T></span>
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </div>
      )}

      <ActionButton className="button primary w-full" disabled={busy} style={{ width: "100%" }}>
        <T>{busy ? "Sending…" : "Send reset link"}</T>
      </ActionButton>
    </ActionForm>
  );
}
