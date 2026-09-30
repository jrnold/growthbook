import {
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { MetricDefaults } from "shared/types/organization";
import { getSnapshotAnalysis } from "../util";
import { ExperimentMetricDefinition, hasEnoughData } from "./experiments";
import { jamesSteinAdjustment } from "./james-stein";

export interface LiftObservation {
  experimentId: string;
  // Relative lift as a proportion, the same units as `maxPercentChange`. This
  // is the displayed value, so a posterior mean when a proper prior is set.
  lift: number;
  standardError?: number;
  // The unshrunk estimate, present when `lift` was pulled toward a prior
  flatPrior?: { lift: number; standardError: number };
}

// Swap estimators by registering another implementation below and changing
// DEFAULT_SUSPICIOUS_CHANGE_ESTIMATORS. `estimate` returns null when it cannot
// produce a usable threshold from the observations it was given.
export interface SuspiciousChangeEstimator {
  id: string;
  description: string;
  minObservations: number;
  // Observations the estimator cannot use (e.g. no standard error)
  isUsable?(observation: LiftObservation): boolean;
  estimate(observations: LiftObservation[]): number | null;
}

export type SuspiciousChangeEstimateStatus =
  | "success"
  | "insufficient-history"
  | "degenerate";

// "organization" pools lifts across every metric; used when the metric's own
// history cannot produce an estimate
export type SuspiciousChangeEstimateSource = "metric" | "organization";

export interface SuspiciousChangeEstimate {
  source: SuspiciousChangeEstimateSource;
  status: SuspiciousChangeEstimateStatus;
  threshold: number | null;
  estimator: string;
  numObservations: number;
  numExperiments: number;
  minObservations: number;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Scales the MAD to be a consistent estimator of the SD under normality
const MAD_TO_SD = 1.4826;

export function robustStandardDeviation(values: number[]): number {
  const center = median(values);
  return MAD_TO_SD * median(values.map((v) => Math.abs(v - center)));
}

export function makeRobustScaleEstimator({
  multiplier,
  minObservations,
}: {
  multiplier: number;
  minObservations: number;
}): SuspiciousChangeEstimator {
  return {
    id: "robust-scale",
    description: `|median| + ${multiplier} × robust SD (1.4826 × MAD) of past relative lifts`,
    minObservations,
    estimate(observations) {
      const lifts = observations.map((o) => o.lift);
      const scale = robustStandardDeviation(lifts);
      if (!(scale > 0)) return null;
      return Math.abs(median(lifts)) + multiplier * scale;
    },
  };
}

const CHI_SQUARED_1_MEDIAN = 0.454936;

// SD of true effects, with each observation's sampling noise removed. Solves
// median((lift - center)^2 / (tau^2 + se^2)) = median of a chi-squared(1): a
// median-based analogue of the Paule-Mandel estimator, so the outliers being
// flagged do not inflate it. Returns 0 when noise alone explains the spread.
export function estimateTrueEffectScale(
  observations: { lift: number; standardError: number }[],
  center: number,
): number {
  const squaredDeviations = observations.map((o) => (o.lift - center) ** 2);
  const variances = observations.map((o) => o.standardError ** 2);
  const excess = (tau: number) =>
    median(squaredDeviations.map((d, i) => d / (tau ** 2 + variances[i]))) -
    CHI_SQUARED_1_MEDIAN;

  if (excess(0) <= 0) return 0;

  // At this tau every ratio is at most the target, so the root is bracketed
  let low = 0;
  let high = Math.sqrt(Math.max(...squaredDeviations) / CHI_SQUARED_1_MEDIAN);
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (excess(mid) > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

interface UnshrunkObservation {
  lift: number;
  standardError: number;
}

export interface TrueEffectDistribution {
  center: number;
  tau: number;
}

// The same shrinkage GrowthBook applies to scaled impact. Its factor B is
// noise variance / total variance, so (1 - B) × total variance is what is
// left for true effects. Like that usage, the prior mean is 0.
export function estimateTrueEffectsJamesStein(
  observations: UnshrunkObservation[],
): TrueEffectDistribution {
  const n = observations.length;
  const lifts = observations.map((o) => o.lift);
  // jamesSteinAdjustment takes one standard error; the root mean square makes
  // the noise variance it removes the average of the per-result variances.
  const commonStandardError = Math.sqrt(
    observations.reduce((sum, o) => sum + o.standardError ** 2, 0) / n,
  );
  const { mean, adjustment } = jamesSteinAdjustment(lifts, commonStandardError);
  const totalVariance =
    lifts.reduce((sum, lift) => sum + (lift - mean) ** 2, 0) / (n - 2);
  return {
    center: mean,
    tau: Math.sqrt((1 - adjustment) * totalVariance),
  };
}

// Resistant to the outliers being flagged, at the cost of a noisier tau
export function estimateTrueEffectsMedian(
  observations: UnshrunkObservation[],
): TrueEffectDistribution {
  const center = median(observations.map((o) => o.lift));
  return { center, tau: estimateTrueEffectScale(observations, center) };
}

function getUnshrunk(o: LiftObservation): UnshrunkObservation | null {
  if (o.flatPrior) return o.flatPrior;
  return o.standardError !== undefined &&
    Number.isFinite(o.standardError) &&
    o.standardError > 0
    ? { lift: o.lift, standardError: o.standardError }
    : null;
}

// Thresholds on the spread of true effects rather than of observed lifts, so
// a large significant lift from a noisy experiment (a type M error) is
// flagged instead of being excused by the noise that produced it.
export function makeTrueEffectScaleEstimator({
  id,
  description,
  estimateTrueEffects,
  multiplier,
  minObservations,
}: {
  id: string;
  description: string;
  estimateTrueEffects: (
    observations: UnshrunkObservation[],
  ) => TrueEffectDistribution;
  multiplier: number;
  minObservations: number;
}): SuspiciousChangeEstimator {
  return {
    id,
    description,
    minObservations,
    isUsable: (o) => getUnshrunk(o) !== null,
    estimate(observations) {
      const { center, tau } = estimateTrueEffects(
        observations.flatMap((o) => getUnshrunk(o) ?? []),
      );
      if (!(tau > 0)) return null;
      return Math.abs(center) + multiplier * tau;
    },
  };
}

export const suspiciousChangeEstimators: Record<
  string,
  SuspiciousChangeEstimator
> = {
  "true-effect-scale": makeTrueEffectScaleEstimator({
    id: "true-effect-scale",
    description:
      "3 × SD of true effects, from James-Stein shrinkage of past relative lifts",
    estimateTrueEffects: estimateTrueEffectsJamesStein,
    multiplier: 3,
    minObservations: 10,
  }),
  // Not in the default chain; swap it in if outliers in a metric's history
  // inflate the James-Stein estimate.
  "true-effect-scale-median": makeTrueEffectScaleEstimator({
    id: "true-effect-scale-median",
    description:
      "|median| + 3 × SD of true effects, from a median-based fit to past relative lifts",
    estimateTrueEffects: estimateTrueEffectsMedian,
    multiplier: 3,
    minObservations: 10,
  }),
  "robust-scale": makeRobustScaleEstimator({
    multiplier: 4,
    minObservations: 10,
  }),
};

// Tried in order; each is attempted on the metric and then on the
// organization before moving to the next.
export const DEFAULT_SUSPICIOUS_CHANGE_ESTIMATORS = [
  "true-effect-scale",
  "robust-scale",
];

export function estimateSuspiciousChangeThreshold(
  observations: LiftObservation[],
  {
    source = "metric",
    estimatorId = DEFAULT_SUSPICIOUS_CHANGE_ESTIMATORS[0],
  }: { source?: SuspiciousChangeEstimateSource; estimatorId?: string } = {},
): SuspiciousChangeEstimate {
  const estimator = suspiciousChangeEstimators[estimatorId];
  if (!estimator) {
    throw new Error(`Unknown suspicious change estimator: ${estimatorId}`);
  }

  const valid = observations.filter(
    (o) => Number.isFinite(o.lift) && (estimator.isUsable?.(o) ?? true),
  );
  const base = {
    source,
    estimator: estimator.id,
    numObservations: valid.length,
    numExperiments: new Set(valid.map((o) => o.experimentId)).size,
    minObservations: estimator.minObservations,
  };

  if (valid.length < estimator.minObservations) {
    return { ...base, status: "insufficient-history", threshold: null };
  }

  const threshold = estimator.estimate(valid);
  if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) {
    return { ...base, status: "degenerate", threshold: null };
  }

  // Round up to the nearest 0.1% so the stored value is readable in the UI
  return {
    ...base,
    status: "success",
    threshold: Math.ceil(threshold * 1000) / 1000,
  };
}

// Pass null for the organization's observations to estimate from the metric
// alone. When nothing succeeds, the metric's result for the preferred
// estimator is returned so its status explains why.
export function estimateSuspiciousChangeThresholdWithFallback(
  metricObservations: LiftObservation[],
  organizationObservations: LiftObservation[] | null,
  estimatorIds: string[] = DEFAULT_SUSPICIOUS_CHANGE_ESTIMATORS,
): SuspiciousChangeEstimate {
  let first: SuspiciousChangeEstimate | null = null;
  for (const estimatorId of estimatorIds) {
    const metricEstimate = estimateSuspiciousChangeThreshold(
      metricObservations,
      { estimatorId },
    );
    if (metricEstimate.status === "success") return metricEstimate;
    first ??= metricEstimate;

    if (organizationObservations) {
      const organizationEstimate = estimateSuspiciousChangeThreshold(
        organizationObservations,
        { source: "organization", estimatorId },
      );
      if (organizationEstimate.status === "success") {
        return organizationEstimate;
      }
    }
  }
  if (!first) throw new Error("No suspicious change estimators were given");
  return first;
}

function getFlatPrior(stats: SnapshotMetric): LiftObservation["flatPrior"] {
  const flat = stats.supplementalResults?.flatPrior;
  if (!flat || !("expected" in flat)) return undefined;
  const lift = flat.expected;
  const standardError = flat.uplift?.stddev;
  return lift !== undefined &&
    Number.isFinite(lift) &&
    standardError !== undefined &&
    standardError > 0
    ? { lift, standardError }
    : undefined;
}

export function getLiftObservationsFromSnapshot({
  experiment,
  snapshot,
  metrics,
  metricDefaults,
}: {
  experiment: { id: string; status: string; type?: string };
  snapshot: ExperimentSnapshotInterface;
  metrics: ExperimentMetricDefinition[];
  metricDefaults: MetricDefaults;
}): LiftObservation[] {
  if (experiment.status !== "stopped") return [];
  if (experiment.type && experiment.type !== "standard") return [];

  const defaultAnalysis = getSnapshotAnalysis(snapshot);
  if (!defaultAnalysis) return [];
  const analysis = getSnapshotAnalysis(snapshot, {
    ...defaultAnalysis.settings,
    differenceType: "relative",
  });
  // The dimension-less row
  const variations = analysis?.results?.[0]?.variations;
  if (!variations?.length) return [];

  const observations: LiftObservation[] = [];
  metrics.forEach((metric) => {
    const baseline = variations[0]?.metrics?.[metric.id];
    if (!baseline) return;
    variations.slice(1).forEach((variation) => {
      const stats = variation.metrics?.[metric.id];
      if (!stats || stats.errorMessage) return;
      if (!hasEnoughData(baseline, stats, metric, metricDefaults)) return;
      const lift = stats.expected;
      if (lift === undefined || !Number.isFinite(lift)) return;
      observations.push({
        experimentId: experiment.id,
        lift,
        standardError: stats.uplift?.stddev,
        flatPrior: getFlatPrior(stats),
      });
    });
  });
  return observations;
}
