import { T } from "@/components/language-provider";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/auth/session";
import SignOutButton from "@/components/sign-out-button";
import { AppNav } from "@/components/app-nav";
import { LogoIcon } from "@/components/icons";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const initial = (identity.name || identity.email || "U").charAt(0).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" aria-label="Groupflow Dashboard">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white shadow-xs">
            <LogoIcon className="w-5 h-5" />
          </span>
          <span>
            group<span className="text-blue-600 font-bold">flow</span>
          </span>
        </Link>
        <div className="nav-label">
          <T>{"Workspace"}</T>
        </div>
        <AppNav />
        <div className="sidebar-foot">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 text-xs flex-shrink-0">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500 font-medium">
                <T>{"Personal Workspace"}</T>
              </div>
              <strong className="text-xs text-slate-900 font-semibold truncate block">
                {identity.name}
              </strong>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
            <span className="text-xs font-medium text-slate-600 hidden sm:inline-block">
              {identity.email}
            </span>
          </div>
          <SignOutButton />
        </header>
        {children}
      </div>
    </div>
  );
}
