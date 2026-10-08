
import { T } from "@/components/language-provider";
import Link from "next/link";
import AuthForm from "@/components/auth-form";

export default function LoginPage() {
  return <main className="login-page"><section className="login-box"><div className="brand">group<span>flow</span></div><div className="eyebrow"><T>{"Your workspace"}</T></div><h1><T>{"Welcome back"}</T></h1><p><T>{"Sign in to organize your group posting workflow."}</T></p><AuthForm mode="login" /><p><Link href="/forgot-password" style={{ color: "var(--green)", fontWeight: 700 }}><T>{"Forgot password?"}</T></Link></p><p><T>{"New to Groupflow? "}</T><Link href="/register" style={{ color: "var(--green)", fontWeight: 700 }}><T>{"Create an account"}</T></Link></p></section></main>;
}
