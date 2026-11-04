import { LanguagePickerSlot, T } from "@/components/language-provider";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/auth/session";
import SignOutButton from "@/components/sign-out-button";
import { AppNav, WorkspaceBreadcrumb } from "@/components/app-nav";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const initial = (identity.name || identity.email || "U").charAt(0).toUpperCase();

  return (
    <div className="app">
      <a href="#workspace-content" className="skip-link"><T>{"Skip to content"}</T></a>
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" aria-label="Groupflow Dashboard">
          <span>
            group<span className="text-blue-600 font-bold">flow</span>
          </span>
        </Link>
        <div className="nav-label">
          <T>{"Workspace"}</T>
        </div>
        <AppNav />
        <div className="sidebar-help">
          <strong><T>{"Ready to post?"}</T></strong>
          <p><T>{"Content, groups, schedule. Everything in one campaign."}</T></p>
          <Link href="/campaigns#new" className="button primary"><T>{"New campaign"}</T></Link>
        </div>
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
          <WorkspaceBreadcrumb />
          <div className="topbar-account">
            <span className="text-xs font-medium text-slate-600 hidden sm:inline-block">
              {identity.email}
            </span>
            <LanguagePickerSlot />
            <SignOutButton />
          </div>
        </header>
        <div id="workspace-content" className="workspace-content" tabIndex={-1}>{children}</div>
      </div>
    </div>
  );
}
