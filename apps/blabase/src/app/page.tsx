import {
  ChevronRight,
  FileSearch,
  GitBranch,
  MessagesSquare,
  ShieldCheck
} from "lucide-react";

import { UrlInputForm } from "@/components/UrlInputForm";

import styles from "./HomePage.module.css";

const pipelineSteps = [
  "Share Parser",
  "Clean Conversation",
  "Turn Builder",
  "Evidence Verifier"
];

const resultFeatures = [
  {
    icon: MessagesSquare,
    title: "Conversation Turns",
    description: "user와 assistant 메시지를 실제 대화 단위로 묶습니다."
  },
  {
    icon: GitBranch,
    title: "Structure & Comparison",
    description: "추출 항목과 대화 흐름을 Turn별로 비교합니다."
  },
  {
    icon: FileSearch,
    title: "Evidence Trace",
    description: "판단 근거를 원문 메시지까지 다시 연결합니다."
  }
];

export default function HomePage() {
  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            b
          </span>
          <span>
            <strong>blabase Extraction Monitor</strong>
            <small>CHATGPT SHARE ANALYSIS</small>
          </span>
        </div>
        <div className={styles.environmentStatus}>
          <span aria-hidden="true" />
          PRIVATE BETA
        </div>
      </header>

      <section className={styles.pipeline} aria-label="분석 파이프라인">
        <strong>Pipeline</strong>
        {pipelineSteps.map((step, index) => (
          <span key={step} className={styles.pipelineStep}>
            {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
            {step}
          </span>
        ))}
        <span className={styles.pipelineMeta}>URL → TURN → EVIDENCE</span>
      </section>

      <section className={styles.content}>
        <header className={styles.pageHeading}>
          <div>
            <p>NEW ANALYSIS</p>
            <h1>새 대화 분석</h1>
          </div>
          <p>
            AI와 나눈 긴 대화를, 다시 꺼내 쓸 수 있는 구조와 근거로 정리합니다.
          </p>
        </header>

        <div className={styles.analysisGrid}>
          <section className={styles.importPanel}>
            <div className={styles.panelHeader}>
              <div>
                <span>STEP 01</span>
                <h2>ChatGPT 공유 링크 가져오기</h2>
              </div>
              <span className={styles.panelBadge}>URL IMPORT</span>
            </div>
            <div className={styles.panelBody}>
              <UrlInputForm />
            </div>
            <footer className={styles.panelFooter}>
              <span>
                <ShieldCheck size={14} aria-hidden="true" />
                분석 결과를 영구 저장하지 않습니다
              </span>
              <code>chatgpt.com/share/...</code>
            </footer>
          </section>

          <aside className={styles.resultPanel} aria-labelledby="result-title">
            <div className={styles.panelHeader}>
              <div>
                <span>AFTER IMPORT</span>
                <h2 id="result-title">분석 결과 화면</h2>
              </div>
              <span className={styles.readyBadge}>
                <i aria-hidden="true" /> READY
              </span>
            </div>

            <div className={styles.monitorPreview} aria-hidden="true">
              <div className={styles.previewToolbar}>
                <span />
                <span />
                <span />
              </div>
              <div className={styles.previewBody}>
                <div className={styles.turnPreview}>
                  <small>TURN LIST</small>
                  <strong>Turn 01</strong>
                  <span className={styles.previewLineLong} />
                  <span className={styles.previewLineShort} />
                  <strong>Turn 02</strong>
                  <span className={styles.previewLineMedium} />
                </div>
                <div className={styles.comparisonPreview}>
                  <small>EXTRACTION COMPARISON</small>
                  <div>
                    <span>INTENT</span>
                    <i className={styles.ruleBar} />
                    <em>VERIFIED</em>
                  </div>
                  <div>
                    <span>DECISION</span>
                    <i className={styles.llmBar} />
                    <em>REVIEW</em>
                  </div>
                  <div>
                    <span>ACTION</span>
                    <i className={styles.ruleBar} />
                    <em>VERIFIED</em>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.featureList}>
              {resultFeatures.map(({ icon: Icon, title, description }) => (
                <article key={title}>
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <footer className={styles.appFooter}>
        <span>blabase · conversation restoration workspace</span>
        <span>분석 결과는 현재 브라우저 세션에서만 유지됩니다</span>
      </footer>
    </main>
  );
}
