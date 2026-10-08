
import { T } from "@/components/language-provider";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/auth/session";
import SignOutButton from "@/components/sign-out-button";

const links = [["Dashboard", "/dashboard"], ["Groups", "/groups"], ["Content", "/content"], ["Campaigns", "/campaigns"], ["Queue", "/queue"], ["History", "/history"], ["Settings", "/settings"]];

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  return <div className="app"><aside className="sidebar"><Link href="/dashboard" className="brand">group<span>flow</span></Link><div className="nav-label"><T>{"Workspace"}</T></div><nav className="nav">{links.map(([label, href]) => <Link href={href} key={href}><T>{label}</T></Link>)}</nav><div className="sidebar-foot"><T>{"Personal Workspace"}</T><br /><strong>{identity.name}</strong></div></aside><div className="main"><header className="topbar"><span>{identity.email}</span><SignOutButton /></header>{children}</div></div>;
}
