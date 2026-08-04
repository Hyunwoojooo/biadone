"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./DashboardShell.module.css";

const navigation = [
  { href: "/", label: "Today" },
  { href: "/projects", label: "Projects" },
  { href: "/sources", label: "Sources" },
  { href: "/settings", label: "Settings" }
] as const;

export function AppHeader() {
  const pathname = usePathname();

  return (
    <>
      <a className={styles.skipLink} href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className={styles.sidebar} aria-label="Blabase dashboard">
        <div className={styles.brandRow}>
          <Link className={styles.brand} href="/">
            BlaBase
          </Link>
          <span className={styles.beta}>Beta</span>
        </div>

        <nav className={styles.navigation} aria-label="주요 화면">
          {navigation.map((item) => {
            const current =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                className={`${styles.navLink} ${
                  current ? styles.navLinkCurrent : ""
                }`}
                href={item.href}
                aria-current={current ? "page" : undefined}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.shortcut}>
            <span>Quick command</span>
            <kbd>⇧ Space</kbd>
          </div>
          <span className={styles.localStatus}>Local companion</span>
        </div>
      </aside>
    </>
  );
}
