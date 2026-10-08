
import { T } from "@/components/language-provider";
import Link from "next/link";
import NewPasswordForm from "@/components/new-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="login-page"><section className="login-box"><div className="brand">group<span>flow</span></div><div className="eyebrow"><T>{"Account recovery"}</T></div><h1><T>{"Choose a new password"}</T></h1><NewPasswordForm token={token ?? ""} /><p><Link href="/login" style={{ color: "var(--green)", fontWeight: 700 }}><T>{"Back to sign in"}</T></Link></p></section></main>;
}
