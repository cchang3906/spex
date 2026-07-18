import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <p className={styles.line}>
        Spex · It runs your tools before you ask · Built at Ramp Builders
        Cup 2026
      </p>
    </footer>
  );
}
