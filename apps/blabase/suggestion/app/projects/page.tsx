import { ProjectMappings } from "../ProjectMappings";
import styles from "../DashboardPage.module.css";

export default function ProjectsPage() {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <p className={styles.eyebrow}>Projects</p>
          <h1>프로젝트와 작업 맥락</h1>
          <p className={styles.description}>
            같은 프로젝트에 속한 GitHub, Codex, Notion, Calendar 범위를
            직접 연결하고 완료 후속 workflow를 설정합니다.
          </p>
        </div>
        <span className={styles.statusPill}>명시적 연결만 적용</span>
      </header>

      <section className={styles.contentPanel} aria-label="프로젝트 연결 설정">
        <ProjectMappings defaultOpen />
      </section>
    </main>
  );
}
