import type { SectionMeta } from "./sections";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  activeId: string;
  items: SectionMeta[];
  label?: string;
};

export function Sidebar({ activeId, items, label = "Contents" }: SidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Contents">
      <p className={styles.label}>{label}</p>
      <ul className={styles.list}>
        {items.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={styles.link}
              aria-current={activeId === section.id ? "true" : undefined}
              data-active={activeId === section.id ? "true" : undefined}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
