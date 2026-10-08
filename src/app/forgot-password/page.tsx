import { T } from "@/components/language-provider";
import Link from "next/link";
import PasswordResetRequestForm from "@/components/password-reset-form";
import { LogoIcon } from "@/components/icons";

export default function ForgotPasswordPage() {
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
          <T>{"Account recovery"}</T>
        </div>
        <h1>
          <T>{"Reset your password"}</T>
        </h1>
        <p>
          <T>{"Enter your account email. If it exists, we will send a reset link."}</T>
        </p>
        <PasswordResetRequestForm />
        <div className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-600">
          <Link href="/login" className="text-blue-600 hover:text-blue-700 font-semibold">
            <T>{"Back to sign in"}</T>
          </Link>
        </div>
      </section>
    </main>
  );
}
