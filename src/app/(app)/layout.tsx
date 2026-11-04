import { LanguagePickerSlot, T } from "@/components/language-provider";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/auth/session";
import SignOutButton from "@/components/sign-out-button";
import { WorkspaceBreadcrumb } from "@/components/app-nav";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const initial = (identity.name || identity.email || "U").charAt(0).toUpperCase();
  const sidebarCollapsed = (await cookies()).get("groupflow_sidebar")?.value === "collapsed";

  return (
    <div className="app">
      <a href="#workspace-content" className="skip-link"><T>{"Skip to content"}</T></a>
      <AppSidebar initialCollapsed={sidebarCollapsed} name={identity.name || identity.email} initial={initial} />
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
