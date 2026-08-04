import Link from "next/link";

import styles from "../DashboardPage.module.css";

export default function SettingsPage() {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <p className={styles.eyebrow}>Settings</p>
          <h1>동작과 진단 설정</h1>
          <p className={styles.description}>
            빠른 실행 방식과 개발 진단 화면을 확인합니다. 데이터 연결과
            프로젝트 범위는 각각의 전용 화면에서 관리합니다.
          </p>
        </div>
        <span className={styles.statusPill}>Local companion</span>
      </header>

      <div className={styles.settingsGrid}>
        <section className={styles.settingsCard}>
          <h2>Quick command</h2>
          <p>
            메뉴바에서 대기하는 Blabase launcher를 열고 현재 추천을 바로
            확인합니다.
          </p>
          <div className={styles.shortcutRow}>
            <span>전역 단축키</span>
            <kbd>⇧ Space</kbd>
          </div>
        </section>

        <section className={styles.settingsCard}>
          <h2>데이터와 프로젝트</h2>
          <p>
            연결 권한과 source 상태, 프로젝트별 명시적 매핑을 전용 화면에서
            관리합니다.
          </p>
          <div className={styles.linkList}>
            <Link href="/sources">Sources &amp; Permissions</Link>
            <Link href="/projects">Project mappings</Link>
          </div>
        </section>

        <section
          className={`${styles.settingsCard} ${styles.settingsCardWide}`}
        >
          <h2>진단과 이전 도구</h2>
          <p>
            Attention Lab은 추천 실행 기록과 근거를 검토하는 개발 화면이며,
            기존 conversation-only 제안기는 회귀 확인을 위해 보존합니다.
          </p>
          <div className={styles.linkList}>
            <Link href="/attention-lab">Attention Lab 열기</Link>
            <Link href="/legacy">Legacy ChatGPT 분석 열기</Link>
          </div>
        </section>

        <section
          className={`${styles.settingsCard} ${styles.settingsCardWide}`}
        >
          <h2>현재 적용되는 원칙</h2>
          <ul className={styles.policyList}>
            <li>추천은 연결되고 평가 가능한 source 범위에서만 만듭니다.</li>
            <li>프로젝트 연결은 사용자가 확인한 경우에만 적용합니다.</li>
            <li>추천 결과의 피드백은 자동으로 Golden Dataset이 되지 않습니다.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
