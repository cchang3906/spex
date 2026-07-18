import { Section } from "./Section";
import prose from "./Prose.module.css";
import styles from "./Architecture.module.css";
import { ink, hairline, blue, yellow, mint } from "./palette";

const admission = [
  "Two triggers only: a completed file edit, the post edit verify predicted from the pattern table; and session start, the cold start pre-run.",
  "At session start the suite launches at epoch 0 before the model says a word, because reproducing the failing state is the most predictable act in a session.",
  "Candidates are deduplicated by command, directory, and epoch; one suite run is enough even when two patterns propose it.",
  "Failing any gate is a silent abstain: it costs nothing, is logged with which gate refused, and is correct behavior, not an error.",
];

const gateDetails = [
  ["resolvable", "a fresh repo abstains here until verification has been seen once"],
  ["allow list", "test, lint, and typecheck families only, never inferred from context"],
  ["confident", "eff_p > 0.35"],
  ["budget", "at most two speculative jobs in flight, a counting semaphore, because the laptop is running Codex too"],
];

const epochRules = [
  "Results live in a cache keyed by kind and epoch, an integer version of the workspace.",
  "Every file change increments the epoch.",
  "Entries and in-flight runs from older epochs are invisible to the lookup: test results about code that no longer exists are worse than no results.",
];

const endings = [
  {
    kicker: "Reused",
    title: "Finished, then asked for",
    body: "The suite completed before the ask, so it serves from the shelf in milliseconds.",
  },
  {
    kicker: "Promoted",
    title: "Asked for mid run",
    body: "The ask joins the running job, which becomes authoritative and non preemptible, keeping the head start it built.",
  },
  {
    kicker: "Discarded",
    title: "Never wanted",
    body: "Codex never asked, or an edit killed the epoch, so the run is thrown away silently and the model never sees it.",
  },
  {
    kicker: "Preempted",
    title: "Evicted for real work",
    body: "Codex started its own command while the slots were full, so the lowest value guess was terminated on the spot.",
  },
];

const gates = [
  { label: "gate 1: a concrete command resolves", width: 300 },
  { label: "gate 2: allow list, test lint typecheck", width: 260 },
  { label: "gate 3: confidence clears tau 0.35", width: 220 },
  { label: "gate 4: a free slot, budget 2", width: 180 },
];

function GatesFunnelDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 330"
      role="img"
      aria-label="Vertical funnel of the four admission gates, with a silent abstain arrow exiting at each gate and a launch box at the bottom"
    >
      <rect x="0" y="0" width="680" height="330" fill="#ffffff" />
      <defs>
        <marker
          id="arrow-funnel"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" fill={ink} />
        </marker>
      </defs>

      <rect x="100" y="12" width="300" height="30" fill={blue} stroke={ink} />
      <text x="250" y="31" fontSize="10" fill={ink} textAnchor="middle">
        prediction candidate
      </text>
      <line
        x1="250"
        y1="42"
        x2="250"
        y2="54"
        stroke={ink}
        markerEnd="url(#arrow-funnel)"
      />

      {gates.map((gate, i) => {
        const y = 58 + i * 50;
        const x = 250 - gate.width / 2;
        return (
          <g key={gate.label}>
            <rect
              x={x}
              y={y}
              width={gate.width}
              height="34"
              fill="#ffffff"
              stroke={ink}
            />
            <text
              x="250"
              y={y + 21}
              fontSize="10"
              fill={ink}
              textAnchor="middle"
            >
              {gate.label}
            </text>
            <line
              x1={x + gate.width}
              y1={y + 17}
              x2="560"
              y2={y + 17}
              stroke={ink}
              strokeDasharray="3 3"
              markerEnd="url(#arrow-funnel)"
            />
            <text x="568" y={y + 21} fontSize="9" fill={ink}>
              abstain
            </text>
            {i < gates.length - 1 ? (
              <line
                x1="250"
                y1={y + 34}
                x2="250"
                y2={y + 46}
                stroke={ink}
                markerEnd="url(#arrow-funnel)"
              />
            ) : null}
          </g>
        );
      })}

      <line
        x1="250"
        y1="242"
        x2="250"
        y2="254"
        stroke={ink}
        markerEnd="url(#arrow-funnel)"
      />
      <rect x="150" y="258" width="200" height="34" fill={yellow} stroke={ink} />
      <text x="250" y="279" fontSize="10" fill={ink} textAnchor="middle">
        admitted: launch speculatively
      </text>
      <text x="420" y="316" fontSize="9" fill={ink}>
        an abstain is silent and costs nothing
      </text>
    </svg>
  );
}

function ColdStartDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 200"
      role="img"
      aria-label="Cold start timeline: the suite pre-runs from second zero while the model reads the issue, so the first ask is served instantly instead of waiting out a full suite"
    >
      <rect x="0" y="0" width="680" height="200" fill="#ffffff" />
      {[80, 210, 340, 470, 600].map((x) => (
        <line key={x} x1={x} y1="20" x2={x} y2="132" stroke={hairline} />
      ))}
      <line x1="80" y1="16" x2="80" y2="136" stroke={ink} />
      <text x="84" y="14" fontSize="9" fill={ink}>
        session start, epoch 0
      </text>

      <text x="8" y="48" fontSize="11" fill={ink}>
        codex
      </text>
      <rect x="80" y="32" width="260" height="24" fill={blue} stroke={ink} />
      <text x="210" y="48" fontSize="10" fill={ink} textAnchor="middle">
        reads the issue, plans
      </text>
      <line x1="340" y1="24" x2="340" y2="62" stroke={ink} />
      <text x="344" y="24" fontSize="9" fill={ink}>
        first ask
      </text>
      <rect x="340" y="32" width="60" height="24" fill={mint} stroke={ink} />
      <text x="370" y="48" fontSize="10" fill={ink} textAnchor="middle">
        served
      </text>

      <text x="8" y="102" fontSize="11" fill={ink}>
        spex
      </text>
      <rect x="80" y="86" width="180" height="24" fill={yellow} stroke={ink} />
      <text x="170" y="102" fontSize="10" fill={ink} textAnchor="middle">
        suite pre-runs at epoch 0
      </text>
      <text x="170" y="128" fontSize="9" fill={ink} textAnchor="middle">
        finished before the first ask
      </text>

      <rect
        x="340"
        y="156"
        width="220"
        height="24"
        fill="#ffffff"
        stroke={blue}
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <text x="450" y="172" fontSize="9" fill={ink} textAnchor="middle">
        without cold start: first verify ran here
      </text>
    </svg>
  );
}

function EpochFencingDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 150"
      role="img"
      aria-label="Cache entries keyed by epoch: an edit bumps epoch 0 to 1, the stale entry is crossed out and invisible, the fresh entry serves"
    >
      <rect x="0" y="0" width="680" height="150" fill="#ffffff" />
      <defs>
        <marker
          id="arrow-epoch"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" fill={ink} />
        </marker>
      </defs>

      <rect x="60" y="70" width="170" height="40" fill={blue} stroke={ink} />
      <text x="145" y="94" fontSize="10" fill={ink} textAnchor="middle">
        test @ epoch 0
      </text>
      <line x1="60" y1="70" x2="230" y2="110" stroke={ink} strokeWidth="1.5" />
      <line x1="60" y1="110" x2="230" y2="70" stroke={ink} strokeWidth="1.5" />
      <text x="145" y="132" fontSize="9" fill={ink} textAnchor="middle">
        stale, invisible to lookup
      </text>

      <line
        x1="240"
        y1="90"
        x2="400"
        y2="90"
        stroke={ink}
        markerEnd="url(#arrow-epoch)"
      />
      <text x="320" y="80" fontSize="9" fill={ink} textAnchor="middle">
        edit bumps epoch 0 to 1
      </text>

      <rect x="410" y="70" width="170" height="40" fill={yellow} stroke={ink} />
      <text x="495" y="94" fontSize="10" fill={ink} textAnchor="middle">
        test @ epoch 1
      </text>
      <text x="495" y="132" fontSize="9" fill={ink} textAnchor="middle">
        fresh, serves in milliseconds
      </text>

      <text x="495" y="24" fontSize="10" fill={ink} textAnchor="middle">
        prefetch_verify asks at epoch 1
      </text>
      <line
        x1="495"
        y1="32"
        x2="495"
        y2="64"
        stroke={ink}
        markerEnd="url(#arrow-epoch)"
      />
    </svg>
  );
}


function TwoLaneDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 300"
      role="img"
      aria-label="Two lanes share one executor: the authoritative lane runs everything Codex asked for at normal priority, the speculative lane holds admitted predictions in two budget slots, and when real work arrives while both slots are busy the lowest utility job is preempted."
    >
      <rect x="0" y="0" width="680" height="300" fill="#ffffff" />

      <rect x="16" y="20" width="420" height="76" fill={blue} opacity="0.28" stroke={ink} />
      <text x="32" y="46" fontSize="12.5" fontWeight="600" fill={ink}>authoritative lane</text>
      <text x="32" y="64" fontSize="10.5" fill={ink} opacity="0.7">everything codex itself asked for, normal priority,</text>
      <text x="32" y="79" fontSize="10.5" fill={ink} opacity="0.7">never queued behind speculation</text>

      <rect x="16" y="176" width="420" height="104" fill="#ffffff" stroke={ink} />
      <text x="32" y="202" fontSize="12.5" fontWeight="600" fill={ink}>speculative lane</text>
      <text x="32" y="220" fontSize="10.5" fill={ink} opacity="0.7">admitted predictions only, low priority</text>
      <text x="32" y="258" fontSize="10.5" fill={ink} opacity="0.7">budget = 2, a counting semaphore</text>
      <rect x="252" y="228" width="80" height="34" fill={yellow} opacity="0.55" stroke={ink} />
      <text x="292" y="249" fontSize="11" fill={ink} textAnchor="middle">slot 1</text>
      <rect x="344" y="228" width="80" height="34" fill={yellow} opacity="0.55" stroke={ink} />
      <text x="384" y="249" fontSize="11" fill={ink} textAnchor="middle">slot 2</text>

      <line x1="228" y1="96" x2="288" y2="224" stroke={ink} strokeDasharray="4 4" />
      <line x1="288" y1="224" x2="281" y2="216" stroke={ink} />
      <line x1="288" y1="224" x2="292" y2="214" stroke={ink} />
      <text x="312" y="128" fontSize="10" fill={ink} opacity="0.65">real work arrives while both slots are busy:</text>
      <text x="312" y="143" fontSize="10" fill={ink} opacity="0.65">the lowest utility job is preempted</text>

      <rect x="512" y="96" width="152" height="108" fill={mint} opacity="0.35" stroke={ink} />
      <text x="588" y="126" fontSize="12.5" fontWeight="600" fill={ink} textAnchor="middle">one executor</text>
      <text x="588" y="146" fontSize="10.5" fill={ink} textAnchor="middle">execute(argv, cwd)</text>
      <text x="588" y="168" fontSize="10" fill={ink} opacity="0.65" textAnchor="middle">the same sandbox</text>
      <text x="588" y="182" fontSize="10" fill={ink} opacity="0.65" textAnchor="middle">codex itself uses</text>

      <line x1="436" y1="58" x2="508" y2="118" stroke={ink} strokeWidth="1.5" />
      <line x1="508" y1="118" x2="498" y2="115" stroke={ink} strokeWidth="1.5" />
      <line x1="508" y1="118" x2="503" y2="109" stroke={ink} strokeWidth="1.5" />
      <line x1="436" y1="240" x2="508" y2="182" stroke={ink} strokeWidth="1.5" />
      <line x1="508" y1="182" x2="498" y2="185" stroke={ink} strokeWidth="1.5" />
      <line x1="508" y1="182" x2="503" y2="191" stroke={ink} strokeWidth="1.5" />
    </svg>
  );
}

export function SpeculationSection() {
  return (
    <Section id="speculation" heading="Speculation rules">
      <p className={prose.paragraph}>
        A prediction on its own does not run anything: it still has to earn one
        of the two speculation slots by passing four gates.
      </p>
      <ul className={prose.bulletList}>
        {admission.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <div className={`${styles.diagram} ${styles.diagramWhite}`}>
        <ColdStartDiagram />
        <p className={styles.diagramCaption}>
          Cold start: the first suite runs while the model is still reading the
          issue. The first edit bumps the epoch and fences the pre-run out.
        </p>
      </div>
      <p className={prose.paragraph}>
        Four gates stand between a candidate and a launch, cheapest veto first:
      </p>
      <div className={`${styles.diagram} ${styles.diagramWhite}`}>
        <GatesFunnelDiagram />
        <p className={styles.diagramCaption}>
          Both triggers pass through the same four gates. Most candidates never
          reach the bottom, and that is the point.
        </p>
      </div>
      <div className={prose.gateRows}>
        {gateDetails.map(([name, detail], i) => (
          <div key={name} className={prose.gateRow}>
            <span className={prose.gateName}>
              gate {i + 1} · {name}
            </span>
            <span className={prose.gateDetail}>{detail}</span>
          </div>
        ))}
      </div>
      <p className={prose.paragraph}>
        When two candidates clear all four gates, the higher expected value
        goes first:
      </p>
      <div className={prose.mathBlock}>
        <span className={prose.mathExpr}>
          <em>EV</em>
          <span>=</span>
          <em>p</em>
          <span>·</span>
          <em>
            t<sub>last</sub>
          </em>
        </span>
        <span className={prose.mathNote}>
          test: 0.87 · 7 s = 6.1&ensp;beats&ensp;lint: 0.58 · 3 s = 1.7
        </span>
      </div>
      <TwoLaneDiagram />
      <p className={prose.paragraph}>
        Freshness is enforced by an epoch fence, not by cleverness:
      </p>
      <ul className={prose.bulletList}>
        {epochRules.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <div className={`${styles.diagram} ${styles.diagramWhite}`}>
        <EpochFencingDiagram />
        <p className={styles.diagramCaption}>
          The lookup only sees the current epoch. Nothing stale can serve, by
          construction.
        </p>
      </div>
      <p className={prose.paragraph}>
        Every speculative job ends in exactly one of four states, set once and
        logged always. Only the first two ever deliver anything to the model.
      </p>
      <div className={styles.cards}>
        {endings.map((ending) => (
          <div key={ending.kicker} className={styles.card}>
            <span className={styles.cardKicker}>{ending.kicker}</span>
            <span className={styles.cardTitle}>{ending.title}</span>
            <span className={styles.cardBody}>{ending.body}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
