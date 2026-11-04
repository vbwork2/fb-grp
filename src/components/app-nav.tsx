"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WORKSPACE_CHANGED_EVENT } from "@/lib/workspace-fetch";
import { T, useLocale } from "@/components/language-provider";
import { translate } from "@/lib/i18n";
import {
  DashboardIcon,
  GroupsIcon,
  ContentIcon,
  CampaignIcon,
  QueueIcon,
  HistoryIcon,
  SettingsIcon,
} from "@/components/icons";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
  { label: "Groups", href: "/groups", icon: GroupsIcon },
  { label: "Content", href: "/content", icon: ContentIcon },
  { label: "Campaigns", href: "/campaigns", icon: CampaignIcon },
  { label: "Queue", href: "/queue", icon: QueueIcon },
  { label: "History", href: "/history", icon: HistoryIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

export function AppNav() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, refresh);
  }, [router]);

  return (
    <nav className="nav" aria-label={translate("Main Navigation", locale)}>
      {navItems.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        const title = translate(label, locale);
        return (
          <Link
            key={href}
            href={href}
            prefetch={true}
            className={isActive ? "active" : undefined}
            aria-current={isActive ? "page" : undefined}
            aria-label={title}
            title={title}
          >
            <Icon className="nav-icon" aria-hidden="true" />
            <span className="nav-label-text"><T>{label}</T></span>
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
