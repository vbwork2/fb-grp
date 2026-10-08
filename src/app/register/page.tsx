
import { T } from "@/components/language-provider";
import Link from "next/link";
import AuthForm from "@/components/auth-form";

export default function RegisterPage() {
  return <main className="login-page"><section className="login-box"><div className="brand">group<span>flow</span></div><div className="eyebrow"><T>{"Create your workspace"}</T></div><h1><T>{"Get started"}</T></h1><p><T>{"A personal workspace is created automatically."}</T></p><AuthForm mode="register" /><p><T>{"Already have an account? "}</T><Link href="/login" style={{ color: "var(--green)", fontWeight: 700 }}><T>{"Sign in"}</T></Link></p></section></main>;
}
