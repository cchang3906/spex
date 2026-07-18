import { Section } from "./Section";
import prose from "./Prose.module.css";
import styles from "./Architecture.module.css";
import { ink, hairline, blue, yellow, mint } from "./palette";

const stages = [
  {
    name: "Transport",
    desc: "Launches codex app-server as a child process and speaks JSON RPC over stdio. Every event the agent produces flows through here.",
  },
  {
    name: "Router",
    desc: "Turns the raw event stream into the moments that matter: completed file edits, tool calls, turn boundaries.",
  },
  {
    name: "Predictor",
    desc: "A mined pattern table looks up the last few tool signatures and answers with what usually comes next: a hash map lookup, about 100 nanoseconds, zero inference.",
  },
  {
    name: "Verifiers",
    desc: 'Resolve what "run the tests" actually means in this repo: config detection first, then a command observed once in this session and persisted, then a stack default.',
  },
  {
    name: "Scheduler",
    desc: "Fires on two triggers, a completed file edit and session start. Admits a candidate through four gates and hands it one of two speculative slots. Failing a gate is a silent abstain, not an error.",
  },
  {
    name: "Executor and cache",
    desc: "Runs the suite speculatively in Codex's own sandbox and shelves the result, keyed by kind and epoch. Every edit bumps the epoch, so stale results can never serve.",
  },
  {
    name: "Serve",
    desc: "When Codex calls prefetch_verify, the answer comes back in milliseconds, or the ask joins a still running job, or it simply runs normally.",
  },
];

const eventStream = [
  "Prediction, admission, abstention, launch, serve, outcome, tokens: each is one event.",
  "The CLI, the dashboard, and the benchmark all read that same stream.",
];

function TimelineDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 180"
      role="img"
      aria-label="Timeline showing the test suite running speculatively while the model is still typing, then served the moment it asks"
    >
      <rect x="0" y="0" width="680" height="180" fill="#ffffff" />
      {[126, 251, 376, 501, 626].map((x) => (
        <line key={x} x1={x} y1="20" x2={x} y2="146" stroke={hairline} />
      ))}

      <text x="8" y="56" fontSize="11" fill={ink}>
        codex
      </text>
      <text x="8" y="130" fontSize="11" fill={ink}>
        spex
      </text>

      <rect x="70" y="38" width="56" height="26" fill={blue} stroke={ink} />
      <text x="98" y="55" fontSize="10" fill={ink} textAnchor="middle">
        edit
      </text>

      <rect x="126" y="38" width="250" height="26" fill={blue} stroke={ink} />
      <text x="251" y="55" fontSize="10" fill={ink} textAnchor="middle">
        model keeps typing
      </text>

      <rect x="376" y="38" width="118" height="26" fill={blue} stroke={ink} />
      <text x="435" y="55" fontSize="10" fill={ink} textAnchor="middle">
        prefetch_verify
      </text>

      <rect x="494" y="38" width="96" height="26" fill={mint} stroke={ink} />
      <text x="542" y="55" fontSize="10" fill={ink} textAnchor="middle">
        served in ms
      </text>

      <line
        x1="126"
        y1="64"
        x2="126"
        y2="112"
        stroke={ink}
        strokeDasharray="3 3"
      />
      <text x="132" y="92" fontSize="9" fill={ink}>
        predict, ~100 ns
      </text>

      <rect x="126" y="112" width="250" height="26" fill={yellow} stroke={ink} />
      <text x="251" y="129" fontSize="10" fill={ink} textAnchor="middle">
        test suite runs speculatively
      </text>

      <line
        x1="376"
        y1="112"
        x2="376"
        y2="70"
        stroke={ink}
        strokeDasharray="3 3"
      />
      <text x="382" y="92" fontSize="9" fill={ink}>
        result already waiting
      </text>

      <text x="126" y="168" fontSize="9" fill={ink}>
        the whole suite ran inside time the model was spending anyway
      </text>
    </svg>
  );
}

export function PipelineSection() {
  return (
    <Section id="how-it-works" heading="How it works">
      <p className={prose.paragraph}>
        The whole system is one daemon, a single process under a thousand lines
        with no dependencies and no build step. Every event from Codex passes
        through seven stages, in order:
      </p>
      <ol className={styles.stages}>
        {stages.map((stage, i) => (
          <li key={stage.name} className={styles.stage}>
            <span className={styles.stageNum}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={styles.stageName}>{stage.name}</span>
            <span className={styles.stageDesc}>{stage.desc}</span>
          </li>
        ))}
      </ol>
      <div className={`${styles.diagram} ${styles.diagramWhite}`}>
        <TimelineDiagram />
        <p className={styles.diagramCaption}>
          The trick, in one picture: the suite runs during the seconds the model
          spends deciding to ask for it.
        </p>
      </div>
      <p className={prose.paragraph}>
        Everything the daemon does emits into one event stream:
      </p>
      <ul className={prose.bulletList}>
        {eventStream.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}
