"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { T } from "@/components/language-provider";
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
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Main Navigation">
      {navItems.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={isActive ? "active" : undefined}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span><T>{label}</T></span>
          </Link>
        );
      })}
    </nav>
  );
}
