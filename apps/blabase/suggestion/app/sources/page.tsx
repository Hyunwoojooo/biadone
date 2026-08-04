import { CodexConnector } from "../CodexConnector";
import { ConnectorTimeline } from "../ConnectorTimeline";
import { GitHubConnector } from "../GitHubConnector";
import { GoogleCalendarConnector } from "../GoogleCalendarConnector";
import { NotionConnector } from "../NotionConnector";
import styles from "../DashboardPage.module.css";

export default function SourcesPage() {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <p className={styles.eyebrow}>Sources &amp; Permissions</p>
          <h1>연결과 데이터 범위</h1>
          <p className={styles.description}>
            추천에 사용할 source, 수집 범위, 마지막 동기화 상태를 한곳에서
            확인하고 관리합니다.
          </p>
        </div>
        <span className={styles.statusPill}>4개 source</span>
      </header>

      <p className={styles.sourceBoundary}>
        추천은 연결되고 갱신된 범위에서만 평가합니다. 연결되지 않았거나
        오래된 source는 결과에 그 상태를 함께 표시합니다.
      </p>

      <div className={styles.sourceStack}>
        <GitHubConnector />
        <CodexConnector />
        <NotionConnector />
        <GoogleCalendarConnector />
      </div>

      <div className={styles.sectionIntro}>
        <div>
          <h2>최근 수집 활동</h2>
          <p>저장된 snapshot에서 확인된 source별 변경을 시간순으로 봅니다.</p>
        </div>
      </div>
      <ConnectorTimeline />
    </main>
  );
}
