"use client";

import { T } from "@/components/language-provider";
import { useRouter } from "next/navigation";
import { SignOutIcon } from "@/components/icons";

export default function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" className="button small" onClick={signOut} title="Sign out of workspace">
      <SignOutIcon className="w-3.5 h-3.5 text-slate-400" />
      <span><T>{"Sign out"}</T></span>
    </button>
  );
}
