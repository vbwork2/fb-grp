"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { T, useLocale } from "@/components/language-provider";
import { translate } from "@/lib/i18n";
const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Groups", href: "/groups" },
  { label: "Content", href: "/content" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Queue", href: "/queue" },
  { label: "History", href: "/history" },
  { label: "Settings", href: "/settings" },
];

export function AppNav() {
  const pathname = usePathname();
  const locale = useLocale();

  return (
    <nav className="nav" aria-label={translate("Main Navigation", locale)}>
      {navItems.map(({ label, href }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={isActive ? "active" : undefined}
            aria-current={isActive ? "page" : undefined}
          >
            <span><T>{label}</T></span>
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkspaceBreadcrumb() {
  const pathname = usePathname();
  const locale = useLocale();
  const current = navItems.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav className="workspace-breadcrumb" aria-label={translate("Breadcrumb", locale)}>
      <Link href="/dashboard"><T>{"Workspace"}</T></Link>
      <span aria-hidden="true">/</span>
      {current && pathname !== current.href ? <>
        <Link href={current.href}><T>{current.label}</T></Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page"><T>{"Details"}</T></span>
      </> : <span aria-current="page"><T>{current?.label ?? "Dashboard"}</T></span>}
    </nav>
  );
}
