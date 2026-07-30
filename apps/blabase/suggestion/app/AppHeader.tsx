"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "Work Cockpit" },
  { href: "/attention-lab", label: "Attention Lab" }
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <>
      <a className="skipLink" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="appHeader">
        <Link className="appBrand" href="/">
          blabase
        </Link>
        <nav aria-label="주요 화면">
          {navigation.map((item) => {
            const current =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                className={current ? "isCurrent" : undefined}
                href={item.href}
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
