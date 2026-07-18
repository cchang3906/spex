import { useState } from "react";
import {
  results,
  modeMedian,
  percentDelta,
  instanceNames,
  median,
} from "../data/benchResults";
import type { BenchMode, BenchRow } from "../data/benchResults";
import styles from "./ComparisonView.module.css";

interface MetricDef {
  label: string;
  hint: string;
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

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

const metrics: MetricDef[] = [
  {
    label: "Wall clock",
    hint: "Time from spawn to turn completed. Resolved runs only, medians per mode.",
    pick: (row) => row.wallMs,
    format: formatSeconds,
    betterWhen: "lower",
    resolvedOnly: true,
  },
  {
    label: "Verification wait",
    hint: "Seconds the model spent blocked on verification, from our own timestamps.",
    pick: (row) => row.verifyStallMs,
    format: formatSeconds,
    betterWhen: "lower",
  },
  {
    label: "Tool call wait, p95",
    hint: "Tail of per call prefetch_verify waits pooled across runs. Hits answer in milliseconds, misses wait out the suite.",
    pick: (row) => (row.toolWaits?.length ? p95(row.toolWaits) : 0),
    format: formatSeconds,
    betterWhen: "lower",
  },
  {
    label: "Tokens",
    hint: "Codex's own usage totals per run. Neutral by construction; observed deltas vary by environment.",
    pick: (row) => row.tokens,
    format: formatTokens,
    betterWhen: "lower",
  },
  {
    label: "Verifications served",
    hint: "Verification calls answered from the speculative cache instead of run on demand.",
    pick: (row) => row.hits,
    format: formatCount,
    betterWhen: "higher",
  },
  {
    label: "Wasted cpu seconds",
    hint: "Runtime of discarded and preempted speculation. Waste on the same screen as savings.",
    pick: (row) => row.wastedMs,
    format: formatSeconds,
    betterWhen: "lower",
  },
];

function spread(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  return (Math.max(...values) - Math.min(...values)) / 2;
}

function modeValues(metric: MetricDef, mode: BenchMode): number[] {
  return results
    .filter(
      (row) => row.mode === mode && (!metric.resolvedOnly || row.resolved),
    )
    .map(metric.pick);
}

function Pending() {
  return (
    <div className={styles.pending}>
      <span className={styles.hollowDot} aria-hidden="true" />
      <span>Awaiting benchmark runs</span>
    </div>
  );
}

function DeltaChip({
  delta,
  betterWhen,
}: {
  delta: number | null;
  betterWhen: "lower" | "higher";
}) {
  if (delta === null) {
    return null;
  }
  const improved = betterWhen === "lower" ? delta < 0 : delta > 0;
  const tone =
    Math.abs(delta) < 0.5
      ? styles.deltaFlat
      : improved
        ? styles.deltaGood
        : styles.deltaBad;
  return (
    <span className={`${styles.delta} ${tone}`}>
      {delta > 0 ? "+" : ""}
      {delta.toFixed(0)}%
    </span>
  );
}

function MetricRow({
  metric,
  focus,
}: {
  metric: MetricDef;
  focus: BenchMode;
}) {
  const baseValues = modeValues(metric, "baseline");
  const onValues = modeValues(metric, "on");
  const baseMedian = median(baseValues);
  const onMedian = median(onValues);
  const hasData = baseMedian !== null && onMedian !== null;
  const max = hasData ? Math.max(baseMedian, onMedian, 1e-9) : 1;

  return (
    <div className={styles.metricRow}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{metric.label}</span>
        <span className={styles.metricHint}>{metric.hint}</span>
      </div>
      <div className={styles.metricBody}>
        {!hasData ? (
          <Pending />
        ) : (
          <>
            <BarLine
              name="Vanilla Codex"
              value={baseMedian}
              max={max}
              spreadValue={spread(baseValues)}
              format={metric.format}
              variant="baseline"
              dimmed={focus !== "baseline"}
            />
            <BarLine
              name="Codex + Spex"
              value={onMedian}
              max={max}
              spreadValue={spread(onValues)}
              format={metric.format}
              variant="on"
              dimmed={focus !== "on"}
            />
          </>
        )}
      </div>
      <div className={styles.metricDelta}>
        {hasData ? (
          <DeltaChip
            delta={percentDelta(baseMedian, onMedian)}
            betterWhen={metric.betterWhen}
          />
        ) : null}
      </div>
    </div>
  );
}

function BarLine({
  name,
  value,
  max,
  spreadValue,
  format,
  variant,
  dimmed,
}: {
  name: string;
  value: number;
  max: number;
  spreadValue: number | null;
  format: (value: number) => string;
  variant: "baseline" | "on";
  dimmed?: boolean;
}) {
  const width = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div className={`${styles.barLine}${dimmed ? ` ${styles.barDimmed}` : ""}`}>
      <span className={styles.barName}>{name}</span>
      <div className={styles.barTrack}>
        <div
          className={variant === "baseline" ? styles.barBaseline : styles.barOn}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={styles.barValue}>
        {format(value)}
        {spreadValue !== null ? (
          <span className={styles.barSpread}> ± {format(spreadValue)}</span>
        ) : null}
      </span>
    </div>
  );
}

function InstanceRows() {
  const names = instanceNames(results);
  if (names.length === 0) {
    return <Pending />;
  }
  return (
    <div className={styles.instanceList}>
      {names.map((name) => {
        const rows = results.filter((row) => row.instance === name);
        const base = modeMedian(rows, "baseline", (row) => row.wallMs, true);
        const on = modeMedian(rows, "on", (row) => row.wallMs, true);
        if (base === null || on === null) {
          return (
            <div key={name} className={styles.instanceRow}>
              <span className={styles.instanceName}>{name}</span>
              <Pending />
            </div>
          );
        }
        const deltaMs = on - base;
        return (
          <div key={name} className={styles.instanceRow}>
            <span className={styles.instanceName}>{name}</span>
            <span className={styles.dotPair}>
              <span className={styles.hollowDot} aria-hidden="true" />
              <span className={styles.dotValue}>{formatSeconds(base)}</span>
              <span className={styles.filledDot} aria-hidden="true" />
              <span className={styles.dotValue}>{formatSeconds(on)}</span>
            </span>
            <span
              className={`${styles.delta} ${
                deltaMs < 0 ? styles.deltaGood : styles.deltaBad
              }`}
            >
              {deltaMs > 0 ? "+" : "-"}
              {formatSeconds(Math.abs(deltaMs))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ComparisonView() {
  const [focus, setFocus] = useState<BenchMode>("on");
  return (
    <section className={styles.view}>
      <header className={styles.header}>
        <p className={styles.kicker}>Head to head</p>
        <div
          className={styles.toggle}
          role="tablist"
          aria-label="Benchmark mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={focus === "baseline"}
            data-active={focus === "baseline"}
            className={styles.toggleBtn}
            onClick={() => setFocus("baseline")}
          >
            <span className={styles.hollowDot} aria-hidden="true" />
            Vanilla Codex
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={focus === "on"}
            data-active={focus === "on"}
            className={styles.toggleBtn}
            onClick={() => setFocus("on")}
          >
            <span className={styles.filledDot} aria-hidden="true" />
            Codex + Spex
          </button>
        </div>
        <p className={styles.subtitle}>
          Same task, same repo state, identical prompts, run back to back on
          the same machine, on{" "}
          <a
            className={styles.subtitleLink}
            href="https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified"
            target="_blank"
            rel="noreferrer"
          >
            SWE-bench Verified
          </a>{" "}
          tasks. Medians per mode fill in as benchmark runs land.
        </p>
      </header>

      <div className={styles.actions}>
        <span title="Wired to the local harness at the booth">
          <button
            type="button"
            className={styles.actionBtn}
            disabled
            title="Wired to the local harness at the booth"
          >
            Run baseline
          </button>
        </span>
        <span title="Wired to the local harness at the booth">
          <button
            type="button"
            className={styles.actionBtn}
            disabled
            title="Wired to the local harness at the booth"
          >
            Run with Spex
          </button>
        </span>
      </div>

      <div className={styles.metrics}>
        {metrics.map((metric) => (
          <MetricRow key={metric.label} metric={metric} focus={focus} />
        ))}
      </div>

      <div className={styles.instances}>
        <div className={styles.instancesHead}>
          <h2 className={styles.instancesTitle}>Per instance wall clock</h2>
          <p className={styles.instancesSub}>
            Hollow dot is vanilla, filled dot is with Spex, signed delta at
            right. Resolved runs only.
          </p>
        </div>
        <InstanceRows />
      </div>
    </section>
  );
}
