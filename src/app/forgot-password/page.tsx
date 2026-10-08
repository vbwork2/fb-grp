
import { T } from "@/components/language-provider";
import Link from "next/link";
import PasswordResetRequestForm from "@/components/password-reset-form";

export default function ForgotPasswordPage() {
  return <main className="login-page"><section className="login-box"><div className="brand">group<span>flow</span></div><div className="eyebrow"><T>{"Account recovery"}</T></div><h1><T>{"Reset your password"}</T></h1><p><T>{"Enter your account email. If it exists, we will send a reset link."}</T></p><PasswordResetRequestForm /><p><Link href="/login" style={{ color: "var(--green)", fontWeight: 700 }}><T>{"Back to sign in"}</T></Link></p></section></main>;
}
