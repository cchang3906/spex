export type BenchMode = "on" | "baseline";

export interface BenchRow {
  round: number;
  mode: BenchMode;
  instance: string;
  wallMs: number;
  resolved: boolean;
  savedMs: number;
  hits: number;
  misses: number;
  speculations: number;
  wastedMs: number;
  tokens: number;
  verifyStallMs: number;
  toolWaits?: number[];
  codexVersion?: string;
}

export const results: BenchRow[] = [];

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function modeMedian(
  rows: BenchRow[],
  mode: BenchMode,
  pick: (row: BenchRow) => number,
  resolvedOnly = false,
): number | null {
  const filtered = rows.filter(
    (row) => row.mode === mode && (!resolvedOnly || row.resolved),
  );
  return median(filtered.map(pick));
}

export function instanceNames(rows: BenchRow[]): string[] {
  return [...new Set(rows.map((row) => row.instance))];
}

export function percentDelta(
  baseline: number | null,
  on: number | null,
): number | null {
  if (baseline === null || on === null || baseline === 0) {
    return null;
  }
  return ((on - baseline) / baseline) * 100;
}
