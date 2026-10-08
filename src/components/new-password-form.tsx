"use client";
import { T } from "@/components/language-provider";


import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const password = new FormData(event.currentTarget).get("password");
    const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
    const result = await response.json() as { error?: { message: string } };
    if (!response.ok) { setError(result.error?.message ?? "Reset link is invalid or expired."); return; }
    router.push("/login");
  }
  return <form className="form" onSubmit={submit}><div className="field"><label htmlFor="newPassword"><T>{"New password"}</T></label><input id="newPassword" name="password" type="password" required minLength={10} maxLength={1024} autoComplete="new-password" /><small><T>{"At least 10 characters and include a number."}</T></small></div>{error && <div className="error" role="alert"><T>{error}</T></div>}<button className="button primary" disabled={token.length < 32}><T>{"Update password"}</T></button></form>;
}
