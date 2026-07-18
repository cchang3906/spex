import { Section } from "./Section";
import prose from "./Prose.module.css";
import styles from "./Architecture.module.css";
import { ink, blue, yellow } from "./palette";

const isolation = [
  "The cache is pull only: the daemon has no push channel into Codex.",
  "Nothing is ever injected into the session and nothing appears in history uninvited.",
  "The transcript cannot contain a speculative result that was not explicitly requested.",
];

const guarantees = [
  "A miss is exactly vanilla Codex: the tool resolves the command and runs it normally, as if the daemon were not there.",
  "Wrong guesses cost zero tokens, because the model never sees discarded or preempted work.",
  "CPU spent on wrong guesses is bounded by the two slot budget, and counted honestly in the event stream rather than hidden.",
  "Only test, lint, and typecheck commands are ever admitted, so everything speculated is side effect free by construction.",
  "Speculation runs in the same sandbox Codex itself uses, never a looser one.",
  "One disclosed exception: the first time no verifier resolves in a repo, the tool answers that none is known yet. That costs a single exchange and teaches the learned tier permanently.",
];


function QuarantineDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 230"
      role="img"
      aria-label="Quarantine: speculative results sit behind a hatched wall Codex cannot see through; the only opening is an explicit prefetch_verify call, and there is no push channel back."
    >
      <rect x="0" y="0" width="680" height="230" fill="#ffffff" />
      <defs>
        <pattern id="qhatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" stroke={ink} strokeWidth="1.4" opacity="0.55" />
        </pattern>
      </defs>

      <rect x="28" y="52" width="200" height="120" fill={blue} opacity="0.35" stroke={ink} />
      <text x="128" y="86" fontSize="13" fontWeight="600" fill={ink} textAnchor="middle">codex</text>
      <text x="128" y="106" fontSize="10.5" fill={ink} opacity="0.7" textAnchor="middle">authoritative lane,</text>
      <text x="128" y="121" fontSize="10.5" fill={ink} opacity="0.7" textAnchor="middle">always full priority</text>

      <rect x="330" y="28" width="14" height="174" fill="url(#qhatch)" stroke={ink} />
      <rect x="330" y="98" width="14" height="34" fill="#ffffff" stroke={ink} />
      <text x="337" y="24" fontSize="10" fill={ink} opacity="0.65" textAnchor="middle">quarantine</text>

      <rect x="420" y="52" width="228" height="120" fill={yellow} opacity="0.3" stroke={ink} />
      <text x="534" y="80" fontSize="13" fontWeight="600" fill={ink} textAnchor="middle">spex cache</text>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={444 + i * 64} y="96" width="52" height="30" fill="#ffffff" stroke={ink} />
      ))}
      <text x="470" y="115" fontSize="9.5" fill={ink} textAnchor="middle">test e1</text>
      <text x="534" y="115" fontSize="9.5" fill={ink} textAnchor="middle">lint e1</text>
      <text x="598" y="115" fontSize="9.5" fill={ink} textAnchor="middle">test e0</text>
      <text x="534" y="150" fontSize="10" fill={ink} opacity="0.65" textAnchor="middle">results shelved by kind and epoch</text>

      <line x1="228" y1="115" x2="330" y2="115" stroke={ink} strokeWidth="1.5" />
      <line x1="344" y1="115" x2="416" y2="115" stroke={ink} strokeWidth="1.5" />
      <line x1="416" y1="115" x2="408" y2="110" stroke={ink} strokeWidth="1.5" />
      <line x1="416" y1="115" x2="408" y2="120" stroke={ink} strokeWidth="1.5" />
      <text x="285" y="105" fontSize="10" fill={ink} opacity="0.75" textAnchor="middle">prefetch_verify</text>
      <text x="285" y="132" fontSize="10" fill={ink} opacity="0.75" textAnchor="middle">only if asked</text>

      <line x1="420" y1="188" x2="240" y2="188" stroke={ink} strokeDasharray="4 4" opacity="0.6" />
      <line x1="322" y1="176" x2="342" y2="200" stroke={ink} strokeWidth="1.6" />
      <line x1="342" y1="176" x2="322" y2="200" stroke={ink} strokeWidth="1.6" />
      <text x="452" y="192" fontSize="10" fill={ink} opacity="0.65">no push channel</text>
    </svg>
  );
}

export function SafetySection() {
  return (
    <Section id="safety" heading="Safety">
      <p className={prose.paragraph}>
        The design goal is losslessness: turning Spex on must never make a
        session worse than not having it. The load-bearing property:
      </p>
      <ul className={prose.bulletList}>
        {isolation.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <QuarantineDiagram />
      <ul className={prose.bulletList}>
        {guarantees.map((guarantee) => (
          <li key={guarantee} className={prose.bulletItem}>
            {guarantee}
          </li>
        ))}
      </ul>
      <p className={prose.paragraph}>
        The worst case of a wrong guess is some bounded CPU heat and one cache
        entry that gets thrown away. The worst case of the whole system is plain
        Codex.
      </p>
    </Section>
  );
}
