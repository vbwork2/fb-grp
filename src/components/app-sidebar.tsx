"use client";

import { useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { T, useLocale } from "@/components/language-provider";
import { translate } from "@/lib/i18n";

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
      <Link href="/dashboard" className="brand" aria-label={translate("Groupflow Dashboard", locale)}>groupflow</Link>
      <button type="button" className="button small sidebar-toggle" aria-expanded={!collapsed}
        aria-controls="workspace-sidebar-content" aria-label={translate(collapsed ? "Expand sidebar" : "Collapse sidebar", locale)}
        title={translate(collapsed ? "Expand sidebar" : "Collapse sidebar", locale)} onClick={toggle}>
        <T>{collapsed ? "Expand" : "Collapse"}</T>
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
