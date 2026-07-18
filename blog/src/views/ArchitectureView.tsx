import { Sidebar } from "./about/Sidebar";
import { OverviewSection } from "./about/OverviewSection";
import { PipelineSection } from "./about/PipelineSection";
import { PredictorSection } from "./about/PredictorSection";
import { SpeculationSection } from "./about/SpeculationSection";
import { SafetySection } from "./about/SafetySection";
import { useScrollSpy } from "./about/useScrollSpy";
import { sections } from "./about/sections";
import styles from "./ArchitectureView.module.css";

const sectionIds = sections.map((section) => section.id);

export function ArchitectureView() {
  const activeId = useScrollSpy(sectionIds);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Spex</h1>
        <p className={styles.lede}>
          gpt-5.6-sol, minus the waiting. Codex codes in a serial tool loop:
          think, call a tool, read the output, think again. Spex predicts the
          tool calls, runs them in a background shadow queue, and serves the
          cached results instantly, so Codex has tool outputs before it even
          knows it needs them.
        </p>
      </header>
      <div className={styles.layout}>
        <Sidebar activeId={activeId} items={sections} />
        <div className={styles.content}>
          <OverviewSection />
          <PipelineSection />
          <PredictorSection />
          <SpeculationSection />
          <SafetySection />
        </div>
      </div>
    </div>
  );
}
