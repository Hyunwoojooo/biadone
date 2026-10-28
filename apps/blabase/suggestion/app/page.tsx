import { WeeklyOutcome } from "./WeeklyOutcome";
import { WorkCockpit } from "./WorkCockpit";
import styles from "./DashboardPage.module.css";

export default function TodayPage() {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <p className={styles.eyebrow}>Today</p>
          <h1>오늘의 Work Cockpit</h1>
          <p className={styles.description}>
            연결된 작업과 실행 현황에서 지금 직접 개입할 한 가지를 확인하고,
            바로 작업을 이어갑니다.
          </p>
        </div>
        <span className={styles.statusPill}>평가 범위 Beta</span>
      </header>

      <WeeklyOutcome />
      <WorkCockpit
        setupActionEnabled={
          process.env.BLABASE_CONTINUATION_SETUP_ACTION_ENABLED === "true"
        }
        monitoringEnabled={
          process.env.BLABASE_WORK_BOARD_MONITORING_ENABLED === "true"
        }
      />
    </main>
  );
}
