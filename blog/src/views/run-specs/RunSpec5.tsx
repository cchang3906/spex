import styles from "./RunSpec5.module.css";

const requirements = [
  "Node 20 or newer",
  "Codex CLI installed and authenticated",
  "Python 3.11, only for the benchmark",
];

const commands = [
  "bash scripts/make-demo-repo.sh /tmp/spex-demo",
  "env -u NODE_OPTIONS SPEX_DASH=1 node src/cli.mjs /tmp/spex-demo",
];

const chips = [
  { text: "speculate test", tone: styles.chipMint },
  { text: "serve hit", tone: styles.chipBlue },
  { text: "hid 6.2s", tone: styles.chipYellow },
];

export function RunSpec5() {
  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Run it yourself</h1>

        <p className={styles.sectionHead}>Before you start</p>
        <ul className={styles.checklist}>
          {requirements.map((req) => (
            <li key={req} className={styles.checkItem}>
              <span className={styles.checkbox} aria-hidden="true">
                {"☐"}
              </span>
              {req}
            </li>
          ))}
        </ul>

        <p className={styles.sectionHead}>Run</p>
        <div className={styles.commands}>
          {commands.map((cmd) => (
            <pre key={cmd} className={styles.command}>
              {cmd}
            </pre>
          ))}
        </div>
        <p className={styles.commandNote}>
          The first command seeds a demo repo with one bug (--large gives it a
          suite that takes about 6 seconds). The second runs Codex through
          Spex with the live dashboard at localhost:7777.
        </p>

        <p className={styles.sectionHead}>You should see</p>
        <div className={styles.chips}>
          {chips.map((chip) => (
            <span key={chip.text} className={`${styles.chip} ${chip.tone}`}>
              {chip.text}
            </span>
          ))}
        </div>
        <p className={styles.chipNote}>
          A "speculate test" line at boot, then the first prefetch_verify
          served as a hit or promotion, for example "prefetch_verify(test)
          served in 2700ms &middot; hid 1466ms of wait".
        </p>

        <div className={styles.footer}>
          <p className={styles.footerLine}>
            A/B: run the same task with SPEX_BASELINE=1 and compare.
            SPEX_MODEL pins the model, SPEX_TABLE selects a pattern
            table.
          </p>
          <p className={styles.footerLine}>
            Source at{" "}
            <a
              href="https://github.com/cchang3906/spex"
              target="_blank"
              rel="noreferrer"
            >
              github.com/cchang3906/spex
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
