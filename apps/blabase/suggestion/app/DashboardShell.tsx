import type { ReactNode } from "react";

import { AppHeader } from "./AppHeader";
import styles from "./DashboardShell.module.css";

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <AppHeader />
      <div className={styles.main}>
        <div className={styles.mainInner}>{children}</div>
      </div>
    </div>
  );
}
