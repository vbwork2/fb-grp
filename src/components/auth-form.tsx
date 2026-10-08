"use client";

import { T } from "@/components/language-provider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon } from "@/components/icons";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.text();
      let result: { error?: { message?: string } | null };
      try {
        result = JSON.parse(body) as { error?: { message?: string } | null };
      } catch {
        throw new Error(
          `The server returned an invalid response (HTTP ${response.status}). Check the terminal running npm run dev.`
        );
      }
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to sign in.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form space-y-4" onSubmit={submit}>
      {mode === "register" && (
        <div className="field">
          <label htmlFor="displayName">
            <T>{"Name"}</T>
          </label>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            required
            maxLength={120}
            placeholder="Your name"
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">
          <T>{"Email"}</T>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          placeholder="name@example.com"
        />
      </div>
      <div className="field">
        <label htmlFor="password">
          <T>{"Password"}</T>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "register" ? 10 : 1}
          maxLength={1024}
          placeholder="••••••••••••"
        />
        {mode === "register" && (
          <small>
            <T>{"Use at least 10 characters, including a number."}</T>
          </small>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </div>
      )}

      <button className="button primary w-full" disabled={busy} style={{ width: "100%" }}>
        <T>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</T>
      </button>
    </form>
  );
}
