import { T } from "@/components/language-provider";
import Link from "next/link";
import AuthForm from "@/components/auth-form";
import { LogoIcon } from "@/components/icons";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-box">
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white shadow-xs">
            <LogoIcon className="w-5 h-5" />
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            group<span className="text-blue-600">flow</span>
          </span>
        </div>
        <div className="eyebrow">
          <T>{"Your workspace"}</T>
        </div>
        <h1>
          <T>{"Welcome back"}</T>
        </h1>
        <p>
          <T>{"Sign in to organize your group posting workflow."}</T>
        </p>
        <AuthForm mode="login" />
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col gap-2.5 text-xs text-slate-600">
          <div>
            <Link
              href="/forgot-password"
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              <T>{"Forgot password?"}</T>
            </Link>
          </div>
          <div>
            <T>{"New to Groupflow? "}</T>
            <Link
              href="/register"
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              <T>{"Create an account"}</T>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
