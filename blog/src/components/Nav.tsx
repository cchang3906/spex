import type { Route } from "../lib/useHashRoute";
import styles from "./Nav.module.css";

const tabs: { id: Route; label: string }[] = [
  { id: "architecture", label: "Architecture" },
  { id: "comparison", label: "Comparison" },
  { id: "eval", label: "Eval" },
  { id: "run", label: "Run" },
];

interface NavProps {
  route: Route;
  onNavigate: (next: Route) => void;
}

export function Nav({ route, onNavigate }: NavProps) {
  return (
    <div className={styles.bar}>
      <nav className={styles.pill} aria-label="Primary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === route ? styles.active : styles.tab}
            aria-current={tab.id === route ? "page" : undefined}
            onClick={() => onNavigate(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <a
          className={styles.external}
          href="https://github.com/cchang3906/spex"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <span aria-hidden="true" className={styles.externalMark}>
            ↗
          </span>
        </a>
      </nav>
    </div>
  );
}
