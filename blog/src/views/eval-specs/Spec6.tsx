import {
  results,
  instanceNames,
  modeMedian,
  median,
  percentDelta,
} from "../../data/benchResults";
import type { BenchRow } from "../../data/benchResults";
import styles from "./Spec6.module.css";

interface SpecAxis {
  num: string;
  name: string;
  question: string;
  definition: string;
  metricLabel: string;
  pick: (row: BenchRow) => number;
  format: (value: number) => string;
  betterWhen: "lower" | "higher";
  resolvedOnly?: boolean;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTokens(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : String(Math.round(value));
}

const axes: SpecAxis[] = [
  {
    num: "1",
    name: "e2e latency",
    question: "Is the whole task actually faster?",
    definition:
      "We start a stopwatch when the run begins and stop it when Codex declares the turn complete. Same task, same repo state, both modes. The difference is the headline. A run only counts if it actually fixed the bug: we re-run the failing tests ourselves afterwards, because fast failures are not wins.",
    metricLabel: "wall clock, median per mode",
    pick: (row) => row.wallMs,
    format: formatSeconds,
    betterWhen: "lower",
    resolvedOnly: true,
  },
  {
    num: "2",
    name: "verification wait",
    question: "How much waiting did we delete?",
    definition:
      "Every time Codex verifies, somebody waits. In vanilla mode Codex waits the full suite duration, every single time. With Spex the suite already ran while the model was typing, so the wait shrinks to however much of the run was left, often milliseconds.",
    metricLabel: "verification wait, median per mode",
    pick: (row) => row.verifyStallMs,
    format: formatSeconds,
    betterWhen: "lower",
  },
  {
    num: "3",
    name: "breakdown and overlap",
    question: "Where did the saved time come from?",
    definition:
      "We split each run's wall clock into buckets: model thinking, tools running, Codex blocked waiting, and overlap, the seconds where the test suite ran while the model was still generating. Overlap is the whole trick made visible: the improvement must show up there or the claim is wrong.",
    metricLabel: "overlap, median per mode",
    pick: (row) => row.savedMs,
    format: formatSeconds,
    betterWhen: "higher",
  },
  {
    num: "4",
    name: "prediction quality",
    question: "Does it actually guess right?",
    definition:
      "Before any live run existed, the pattern table sat an exam on trajectories it never trained on, including real Codex sessions from a different machine. During the benchmark, every prediction gets scored live against what Codex actually asks for.",
    metricLabel: "served predictions, median per mode",
    pick: (row) => row.hits,
    format: formatCount,
    betterWhen: "higher",
  },
  {
    num: "5",
    name: "overhead and safety",
    question: "What does being wrong cost?",
    definition:
      "Wrong guesses burn laptop CPU, never correctness. We report the burn as a rate, and we audit that speculation could never have touched anything: only test, lint, and typecheck commands are ever admitted, results are quarantined until Codex explicitly asks, and both modes must end with the same bug fixed.",
    metricLabel: "wasted cpu, median per mode",
    pick: (row) => row.wastedMs,
    format: formatSeconds,
    betterWhen: "lower",
  },
  {
    num: "6",
    name: "token cost",
    question: "Did speed cost tokens?",
    definition:
      'It shouldn\'t: wrong guesses are never shown to the model, and a served result is the same text Codex would have received anyway, just earlier. But "shouldn\'t" is not a number, so we bill it. Codex reports its own token usage during every run, and we record the total per mode.',
    metricLabel: "tokens, median per mode",
    pick: (row) => row.tokens,
    format: formatTokens,
    betterWhen: "lower",
  },
];

function axisMedians(axis: SpecAxis): {
  base: number | null;
  on: number | null;
} {
  return {
    base: modeMedian(results, "baseline", axis.pick, axis.resolvedOnly ?? false),
    on: modeMedian(results, "on", axis.pick, axis.resolvedOnly ?? false),
  };
}

function verdict(
  base: number | null,
  on: number | null,
  betterWhen: "lower" | "higher",
): string {
  const delta = percentDelta(base, on);
  if (delta === null) return "";
  if (Math.abs(delta) < 0.5) return "~";
  const improved = betterWhen === "lower" ? delta < 0 : delta > 0;
  return improved ? "✓" : "✗";
}


function HeroStats() {
  const on = results.filter((r) => r.mode === "on");
  const base = results.filter((r) => r.mode === "baseline");
  if (on.length === 0) return null;
  const savedRuns = on.filter((r) => r.savedMs > 0).length;
  const stallOn = median(on.map((r) => r.verifyStallMs));
  const stallBase = median(base.map((r) => r.verifyStallMs));
  const stallPct =
    stallOn !== null && stallBase ? Math.round((1 - stallOn / stallBase) * 100) : null;
  const wasted = on.reduce((a, r) => a + r.wastedMs, 0);
  return (
    <div className={styles.heroStats}>
      <div className={styles.heroStat}>
        <span className={styles.heroValue}>
          {Math.round((savedRuns / on.length) * 100)}%
        </span>
        <span className={styles.heroLabel}>
          of runs banked savings ({savedRuns} of {on.length})
        </span>
      </div>
      {stallPct !== null && stallPct > 0 ? (
        <div className={styles.heroStat}>
          <span className={styles.heroValue}>-{stallPct}%</span>
          <span className={styles.heroLabel}>median verification wait</span>
        </div>
      ) : null}
      <div className={styles.heroStat}>
        <span className={styles.heroValue}>{(wasted / 1000).toFixed(1)}s</span>
        <span className={styles.heroLabel}>cpu wasted on wrong guesses</span>
      </div>
    </div>
  );
}

function Scoreboard() {
  const live = results.length > 0;
  return (
    <div className={styles.boardWrap}>
      <table className={styles.board}>
        <thead>
          <tr>
            <th className={styles.thAxis}>axis</th>
            <th className={styles.thBase}>vanilla codex</th>
            <th className={styles.thOn}>codex + spex</th>
            <th className={styles.thDelta}>delta</th>
            <th className={styles.thVerdict}></th>
          </tr>
        </thead>
        <tbody>
          {axes.map((axis) => {
            const { base, on } = axisMedians(axis);
            const delta = percentDelta(base, on);
            return (
              <tr key={axis.num}>
                <td className={styles.tdAxis}>
                  <a href={`#combo-${axis.num}`}>{axis.name}</a>
                </td>
                <td className={styles.tdBase}>
                  {base === null ? "pending" : axis.format(base)}
                </td>
                <td className={styles.tdOn}>
                  {on === null ? "pending" : axis.format(on)}
                </td>
                <td className={styles.tdDelta}>
                  {delta === null
                    ? "pending"
                    : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`}
                </td>
                <td className={styles.tdVerdict}>
                  {verdict(base, on, axis.betterWhen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.boardNote}>
        {live
          ? "medians per mode across all runs"
          : "awaiting benchmark runs"}
      </p>
    </div>
  );
}

const BAR_WIDTH = 24;

function BarRow({
  label,
  value,
  max,
  format,
  variant,
}: {
  label: string;
  value: number | null;
  max: number;
  format: (value: number) => string;
  variant: "base" | "on";
}) {
  const filled =
    value === null || max <= 0
      ? 0
      : Math.min(BAR_WIDTH, Math.max(0, Math.round((value / max) * BAR_WIDTH)));
  return (
    <div className={styles.row}>
      <span
        className={variant === "on" ? styles.rowLabelOn : styles.rowLabel}
      >
        {label}
      </span>
      <span className={styles.bar} aria-hidden="true">
        <span className={variant === "base" ? styles.fillBase : styles.fillOn}>
          {"█".repeat(filled)}
        </span>
        <span className={styles.barRest}>{"░".repeat(BAR_WIDTH - filled)}</span>
      </span>
      <span className={styles.val}>
        {value === null ? "pending" : format(value)}
      </span>
    </div>
  );
}

function DeltaLine({
  base,
  on,
  betterWhen,
}: {
  base: number | null;
  on: number | null;
  betterWhen: "lower" | "higher";
}) {
  const delta = percentDelta(base, on);
  return (
    <div className={styles.delta}>
      {delta === null
        ? "delta pending"
        : `delta ${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`}
      {" / "}
      {betterWhen} is better
    </div>
  );
}


function AxisCard({ axis }: { axis: SpecAxis }) {
  const names = instanceNames(results);
  const live = names.length > 0;

  let liveMax = 0;
  if (live) {
    for (const name of names) {
      const rows = results.filter((row) => row.instance === name);
      for (const mode of ["baseline", "on"] as const) {
        const value = modeMedian(rows, mode, axis.pick, axis.resolvedOnly ?? false);
        if (value !== null && value > liveMax) {
          liveMax = value;
        }
      }
    }
  }
  return (
    <article id={`combo-${axis.num}`} className={styles.card}>
      <p className={styles.cardHead}>
        {axis.num} {axis.name}
      </p>
      <p className={styles.question}>{axis.question}</p>
      <p className={styles.def}>{axis.definition}</p>
      <div className={styles.chart}>
        {live ? (
          <>
            {names.map((name) => {
              const rows = results.filter((row) => row.instance === name);
              const base = modeMedian(
                rows,
                "baseline",
                axis.pick,
                axis.resolvedOnly ?? false,
              );
              const on = modeMedian(rows, "on", axis.pick, axis.resolvedOnly ?? false);
              return (
                <div key={name} className={styles.group}>
                  <p className={styles.groupLabel}>{name}</p>
                  <BarRow
                    label="vanilla codex"
                    value={base}
                    max={liveMax}
                    format={axis.format}
                    variant="base"
                  />
                  <BarRow
                    label="codex + spex"
                    value={on}
                    max={liveMax}
                    format={axis.format}
                    variant="on"
                  />
                  <DeltaLine base={base} on={on} betterWhen={axis.betterWhen} />
                </div>
              );
            })}
            <p className={styles.note}>{axis.metricLabel}</p>
          </>
        ) : (
          <>
            <BarRow
              label="vanilla codex"
              value={null}
              max={0}
              format={axis.format}
              variant="base"
            />
            <BarRow
              label="codex + spex"
              value={null}
              max={0}
              format={axis.format}
              variant="on"
            />
            <DeltaLine base={null} on={null} betterWhen={axis.betterWhen} />
            <p className={styles.note}>
              awaiting benchmark runs / {axis.metricLabel}
            </p>
          </>
        )}
      </div>
    </article>
  );
}

export function EvalSpec6() {
  return (
    <section className={styles.page}>
      <header id="setup" className={styles.header}>
          <p className={styles.lede}>
          The evals and traces for our proof, across six axes.
        </p>
        <p className={styles.benchLink}>
          Benchmark tasks are real bugs from{" "}
          <a
            href="https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified"
            target="_blank"
            rel="noreferrer"
          >
            SWE-bench Verified
          </a>
          , four instances chosen by measured verification cost, a 0.3 s
          control plus 1.5 s, 6.7 s, and 19 s suites.
        </p>
        <p className={styles.traceLink}>
          Every number extracts from raw event traces committed with the code:{" "}
          <a
            href="https://github.com/cchang3906/spex/tree/main/speculator/bench-runs"
            target="_blank"
            rel="noreferrer"
          >
            bench-runs, one jsonl per run plus formatted timelines
          </a>
        </p>
        <p className={styles.constantsLine}>
          Held constant: gpt-5.6-sol pinned, Codex CLI version recorded per run, same laptop,
          sequential runs, identical prompts in both modes, fresh repo export
          per run, pattern table re-mined without benchmark instances, budget 2
          slots, tau 0.35. Every knob pinned in code, none assumed.
        </p>
      </header>
      <HeroStats />
      <Scoreboard />
      {axes.map((axis) => (
        <AxisCard key={axis.num} axis={axis} />
      ))}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchBase}`} /> vanilla
          codex
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchOn}`} /> codex +
          spex
        </span>
      </div>
    </section>
  );
}
