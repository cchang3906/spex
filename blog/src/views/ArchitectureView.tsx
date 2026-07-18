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
          gpt-5.6-sol, but faster. Spex predicts the tools Codex is about to
          call and has the results served before the model even knows it needs
          them.
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
