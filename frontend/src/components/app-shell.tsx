import Link from "next/link";
import type { ReactNode } from "react";

import type { CurrentUser } from "@/lib/session";
import { LogoutButton } from "@/components/logout-button";

interface NavigationItem {
  label: string;
  href: string;
}

function navigationFor(role: CurrentUser["role"]): NavigationItem[] {
  if (role === "admin") {
    return [
      { label: "Overview", href: "/admin" },
      { label: "Accounts", href: "/admin/accounts" },
      { label: "Profile", href: "/account/profile" },
    ];
  }
  if (role === "moderator") {
    return [
      { label: "Overview", href: "/moderator" },
      { label: "My profile", href: "/account/profile" },
    ];
  }
  return [
    { label: "Overview", href: "/dashboard" },
    { label: "Flights", href: "/flights" },
    { label: "Stays", href: "/hotels" },
    { label: "Itineraries", href: "/itineraries" },
    { label: "Stories", href: "/blog" },
    { label: "Profile", href: "/account/profile" },
  ];
}

function roleLabel(role: CurrentUser["role"]): string {
  if (role === "admin") return "Administrator";
  if (role === "moderator") return "Moderator";
  return "Traveller";
}

export function AppShell({
  user,
  children,
}: {
  user: CurrentUser;
  children: ReactNode;
}) {
  const navigation = navigationFor(user.role);

  return (
    <div className="workspace">
      <header className="workspace-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>wayfarer</span>
        </Link>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="workspace-account">
          <div
            className="notification-slot"
            data-slot="notification-bell"
            aria-label="Notification bell integration slot"
          >
            Notifications
          </div>
          <div className="account-identity">
            <strong>{user.name}</strong>
            <span>{roleLabel(user.role)}</span>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="workspace-main">{children}</main>
    </div>
  );
}
