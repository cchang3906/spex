import { Section } from "./Section";
import prose from "./Prose.module.css";
import styles from "./Architecture.module.css";
import { ink, hairline, blue, yellow, mint } from "./palette";

const facts = [
  "One process",
  "Zero dependencies",
  "Zero inference",
  "One added tool",
  "One steering file",
];

const mechanism = [
  "A daemon launches codex app-server as a child process and watches every event it emits over JSON RPC.",
  "When Codex finishes a file edit, a mined pattern table already knows verification usually comes next.",
  "The suite starts while the model is still typing, so the result is waiting by the time the question arrives.",
  "At session start the suite also pre-runs at epoch 0, before the model says a word.",
];

const claim = [
  "Hits answer from cache in milliseconds, so the median call collapses.",
  "A guess still in flight has banked a head start by the time the ask lands, so the tail shrinks too.",
  "Correctness and tokens stay untouched; only the waiting moves.",
];


function WrapDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 240"
      role="img"
      aria-label="Spex wraps Codex: the daemon watches the event stream over JSON RPC, predicts the ask, runs it early, and holds the result; Codex is untouched and reaches the cache only through prefetch_verify."
    >
      <rect x="0" y="0" width="680" height="240" fill="#ffffff" />
      <rect x="16" y="16" width="648" height="208" fill="#ffffff" stroke={ink} />
      <text x="32" y="42" fontSize="13" fontWeight="600" fill={ink}>spex · the control plane</text>
      <text x="32" y="60" fontSize="11" fill={ink} opacity="0.65">watches, predicts, runs early, holds the result</text>

      <rect x="220" y="82" width="240" height="112" fill={blue} opacity="0.35" stroke={ink} />
      <text x="240" y="112" fontSize="13" fontWeight="600" fill={ink}>codex · the agent</text>
      <text x="240" y="132" fontSize="11" fill={ink} opacity="0.7">reads, thinks, edits</text>
      <text x="240" y="148" fontSize="11" fill={ink} opacity="0.7">untouched otherwise</text>

      <line x1="130" y1="138" x2="216" y2="138" stroke={ink} strokeWidth="1.5" />
      <line x1="216" y1="138" x2="208" y2="133" stroke={ink} strokeWidth="1.5" />
      <line x1="216" y1="138" x2="208" y2="143" stroke={ink} strokeWidth="1.5" />
      <line x1="130" y1="138" x2="138" y2="133" stroke={ink} strokeWidth="1.5" />
      <line x1="130" y1="138" x2="138" y2="143" stroke={ink} strokeWidth="1.5" />
      <text x="173" y="128" fontSize="10" fill={ink} opacity="0.65" textAnchor="middle">json rpc</text>
      <text x="173" y="154" fontSize="10" fill={ink} opacity="0.65" textAnchor="middle">over stdio</text>

      <rect x="36" y="96" width="94" height="84" fill="#ffffff" stroke={ink} />
      <text x="83" y="120" fontSize="10.5" fill={ink} textAnchor="middle">event stream</text>
      <text x="83" y="136" fontSize="10.5" fill={ink} textAnchor="middle">predict</text>
      <text x="83" y="152" fontSize="10.5" fill={ink} textAnchor="middle">speculate</text>
      <text x="83" y="168" fontSize="10.5" fill={ink} textAnchor="middle">cache</text>

      <rect x="484" y="124" width="126" height="28" fill={mint} opacity="0.5" stroke={ink} />
      <text x="547" y="142" fontSize="10.5" fill={ink} textAnchor="middle">prefetch_verify</text>
      <text x="547" y="168" fontSize="9.5" fill={ink} opacity="0.6" textAnchor="middle">the one added tool</text>
      <line x1="484" y1="138" x2="460" y2="138" stroke={ink} />
    </svg>
  );
}

function TimelinePairDiagram() {
  return (
    <svg
      className={styles.diagramSvg}
      viewBox="0 0 680 258"
      role="img"
      aria-label="Two timelines: vanilla Codex generates, asks, then waits out the full test suite, while with Spex the suite runs concurrently under generation and only a tiny wait remains at the ask."
    >
      <rect x="0" y="0" width="680" height="258" fill="#ffffff" />
      {[80, 210, 340, 470, 600].map((x) => (
        <line key={x} x1={x} y1="18" x2={x} y2="210" stroke={hairline} />
      ))}

      <text x="8" y="46" fontSize="11" fill={ink}>
        vanilla
      </text>
      <rect x="80" y="30" width="250" height="24" fill={blue} stroke={ink} />
      <text x="205" y="46" fontSize="10" fill={ink} textAnchor="middle">
        model generates
      </text>
      <line x1="330" y1="22" x2="330" y2="62" stroke={ink} />
      <text x="334" y="22" fontSize="9" fill={ink}>
        ask
      </text>
      <rect x="330" y="30" width="200" height="24" fill={blue} stroke={ink} />
      <text x="430" y="46" fontSize="10" fill={ink} textAnchor="middle">
        waits out the suite
      </text>
      <line x1="530" y1="22" x2="530" y2="62" stroke={ink} />
      <text x="534" y="22" fontSize="9" fill={ink}>
        answer
      </text>

      <text x="8" y="146" fontSize="11" fill={ink}>
        spex
      </text>
      <rect
        x="110"
        y="124"
        width="200"
        height="70"
        fill={mint}
        opacity="0.55"
      />
      <rect x="80" y="130" width="250" height="24" fill={yellow} stroke={ink} />
      <text x="205" y="146" fontSize="10" fill={ink} textAnchor="middle">
        model generates
      </text>
      <line
        x1="110"
        y1="154"
        x2="110"
        y2="162"
        stroke={ink}
        strokeDasharray="2 2"
      />
      <rect
        x="110"
        y="162"
        width="200"
        height="24"
        fill={yellow}
        stroke={ink}
      />
      <text x="210" y="178" fontSize="10" fill={ink} textAnchor="middle">
        test suite runs early
      </text>
      <text x="106" y="176" fontSize="9" fill={ink} textAnchor="end">
        edit
      </text>
      <line x1="330" y1="122" x2="330" y2="194" stroke={ink} />
      <text x="334" y="122" fontSize="9" fill={ink}>
        ask
      </text>
      <rect x="330" y="130" width="16" height="24" fill={mint} stroke={ink} />
      <text x="352" y="146" fontSize="9" fill={ink}>
        served in ms
      </text>
      <text x="210" y="208" fontSize="9" fill={ink} textAnchor="middle">
        overlap: the suite hides inside generation
      </text>

      <line
        x1="346"
        y1="232"
        x2="530"
        y2="232"
        stroke={ink}
        strokeDasharray="3 3"
      />
      <line x1="346" y1="226" x2="346" y2="238" stroke={ink} />
      <line x1="530" y1="226" x2="530" y2="238" stroke={ink} />
      <text x="438" y="224" fontSize="9" fill={ink} textAnchor="middle">
        the wait that disappeared
      </text>
    </svg>
  );
}

export function OverviewSection() {
  return (
    <Section id="overview">
      <p className={prose.paragraph}>
        Spex is a speculative execution layer for a coding agent's tool
        calls. It wraps OpenAI Codex and runs its verification, the tests, the
        linter, the typechecker, before the model asks for it.{" "}
        <mark className={prose.mark}>It runs your tools before you ask.</mark>
      </p>
      <ul className={prose.bulletList}>
        {mechanism.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <p className={prose.paragraph}>
        The measurable claim:{" "}
        <mark className={prose.mark}>
          speculative verification reliably converts a portion of every tool
          wait into results that are already finished when Codex asks.
        </mark>
      </p>
      <ul className={prose.bulletList}>
        {claim.map((item) => (
          <li key={item} className={prose.bulletItem}>
            {item}
          </li>
        ))}
      </ul>
      <div className={`${styles.diagram} ${styles.diagramWhite}`}>
        <TimelinePairDiagram />
        <p className={styles.diagramCaption}>
          Same generation, same suite. Vanilla pays for them in sequence;
          Spex overlaps them and pays only the sliver left at the ask.
        </p>
      </div>
      <WrapDiagram />
      <div className={prose.pillRow}>
        {facts.map((fact) => (
          <span key={fact} className={prose.pill}>
            {fact}
          </span>
        ))}
      </div>
    </Section>
  );
}
