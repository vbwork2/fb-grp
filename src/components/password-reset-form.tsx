"use client";
import { T } from "@/components/language-provider";


import { useState } from "react";

export default function PasswordResetRequestForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setError("");
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json() as { error?: { message: string }; data?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to request a password reset.");
      setMessage(result.data?.message ?? "If the account exists, we will send a reset link.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to request a password reset."); }
  }
  return <form className="form" onSubmit={submit}><div className="field"><label htmlFor="resetEmail"><T>{"Email"}</T></label><input id="resetEmail" name="email" type="email" required autoComplete="email" /></div>{message && <div className="notice"><T>{message}</T></div>}{error && <div className="error" role="alert"><T>{error}</T></div>}<button className="button primary"><T>{"Send reset link"}</T></button></form>;
}
