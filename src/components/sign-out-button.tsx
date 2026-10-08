"use client";
import { T } from "@/components/language-provider";


import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return <button className="button small" onClick={signOut}><T>{"Sign out"}</T></button>;
}
