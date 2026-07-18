import styles from "./Hero.module.css";

function scrollToContent() {
  window.scrollTo({ top: window.innerHeight, behavior: "smooth" });
}

function ChevronDown() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.titleBlock}>
        <p className={styles.kicker}>A speculative execution layer for Codex</p>
        <h1 className={styles.title}>Spex</h1>
        <p className={styles.subtitle}>It runs your tools before you ask</p>
        <p className={styles.meta}>
          Built at Ramp Builders Cup 2026 · Wraps OpenAI Codex · Open source
        </p>
      </div>

      <button
        type="button"
        className={styles.scroll}
        aria-label="Scroll to content"
        onClick={scrollToContent}
      >
        <ChevronDown />
      </button>
    </section>
  );
}
