"use client";

import { useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { T, useLocale } from "@/components/language-provider";
import { translate } from "@/lib/i18n";
import { LogoIcon, ChevronRightIcon, ChevronLeftIcon } from "@/components/icons";

export function AppSidebar({ initialCollapsed = false, name, initial }: {
  initialCollapsed?: boolean;
  name: string;
  initial: string;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const locale = useLocale();

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `groupflow_sidebar=${next ? "collapsed" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }

  return <aside className="sidebar" data-collapsed={collapsed} aria-label={translate("Workspace sidebar", locale)}>
    <div className="sidebar-header">
      <Link href="/dashboard" className="brand" aria-label={translate("Groupflow Dashboard", locale)}>
        <span className="brand-badge" aria-hidden="true">
          <LogoIcon className="brand-logo" />
        </span>
        <span className="brand-text">group<span className="brand-accent">flow</span></span>
      </Link>
      <button
        type="button"
        className="button small sidebar-toggle"
        aria-expanded={!collapsed}
        aria-controls="workspace-sidebar-content"
        aria-label={translate(collapsed ? "Expand sidebar" : "Collapse sidebar", locale)}
        title={translate(collapsed ? "Expand sidebar" : "Collapse sidebar", locale)}
        onClick={toggle}
      >
        <span className="sidebar-toggle-icon" aria-hidden="true">
          {collapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronLeftIcon className="w-4 h-4" />}
        </span>
        <span className="sidebar-toggle-text">
          <T>{collapsed ? "Expand" : "Collapse"}</T>
        </span>
      </button>
    </div>
    <div id="workspace-sidebar-content" className="sidebar-content">
      <div className="nav-label"><T>{"Workspace"}</T></div>
      <AppNav />
      <div className="sidebar-help">
        <strong><T>{"Ready to post?"}</T></strong>
        <p><T>{"Content, groups, schedule. Everything in one campaign."}</T></p>
        <Link href="/campaigns#new" className="button primary"><T>{"New campaign"}</T></Link>
      </div>
      <div className="sidebar-foot" title={name}>
        <span className="sidebar-avatar" aria-hidden="true">{initial}</span>
        <div className="sidebar-user-copy">
          <span><T>{"Personal Workspace"}</T></span>
          <strong>{name}</strong>
        </div>
      </div>
    </div>
  </aside>;
}
