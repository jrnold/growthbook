import normal from "@stdlib/stats/base/dists/normal";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  LiftObservation,
  estimateSuspiciousChangeThreshold,
  estimateSuspiciousChangeThresholdWithFallback,
  estimateTrueEffectScale,
  estimateTrueEffectsJamesStein,
  estimateTrueEffectsMedian,
  getLiftObservationsFromSnapshot,
  makeRobustScaleEstimator,
  median,
  robustStandardDeviation,
  suspiciousChangeEstimators,
} from "../src/experiments/suspicious-change-threshold";
import { jamesSteinAdjustment } from "../src/experiments/james-stein";

function observations(lifts: number[]): LiftObservation[] {
  return lifts.map((lift, i) => ({ experimentId: `exp_${i}`, lift }));
}

function withStandardErrors(
  obs: LiftObservation[],
): { lift: number; standardError: number }[] {
  return obs.map((o) => ({
    lift: o.lift,
    standardError: o.standardError as number,
  }));
}

const settings: ExperimentSnapshotAnalysisSettings = {
  dimensions: [],
  statsEngine: "frequentist",
  regressionAdjusted: false,
  sequentialTesting: false,
  baselineVariationIndex: 0,
  differenceType: "relative",
  pValueCorrection: null,
  numGoalMetrics: 1,
  numGuardrailMetrics: 0,
};

const metric = { id: "fact__m", minSampleSize: 100 } as FactMetricInterface;

function snapshotMetric(overrides: Partial<SnapshotMetric>): SnapshotMetric {
  return { value: 500, cr: 0.1, users: 5000, ...overrides };
}

function makeSnapshot(
  variationMetrics: SnapshotMetric[],
  analysisSettings: ExperimentSnapshotAnalysisSettings[] = [settings],
): ExperimentSnapshotInterface {
  return {
    experiment: "exp_1",
    analyses: analysisSettings.map((s) => ({
      settings: s,
      dateCreated: new Date(),
      status: "success",
      results: [
        {
          name: "",
          srm: 1,
          variations: variationMetrics.map((m) => ({
            users: m.users,
            metrics: { [metric.id]: m },
          })),
        },
      ],
    })),
  } as unknown as ExperimentSnapshotInterface;
}

describe("median and robustStandardDeviation", () => {
  it("handles odd and even lengths without mutating the input", () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("scales the MAD to the normal SD", () => {
    // median 3, absolute deviations [2, 1, 0, 1, 2] => MAD 1
    expect(robustStandardDeviation([1, 2, 3, 4, 5])).toBeCloseTo(1.4826);
  });
});

describe("robust scale estimator", () => {
  const estimator = makeRobustScaleEstimator({
    multiplier: 4,
    minObservations: 5,
  });

  it("returns |median| + multiplier * robust SD", () => {
    const lifts = [-0.02, -0.01, 0, 0.01, 0.02].map((v) => v + 0.01);
    // median 0.01, MAD 0.01
    expect(estimator.estimate(observations(lifts))).toBeCloseTo(
      0.01 + 4 * 1.4826 * 0.01,
    );
  });

  it("is not moved by the outliers it is meant to flag", () => {
    const clean = [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03];
    const withOutlier = [...clean.slice(0, -1), 25];
    expect(estimator.estimate(observations(withOutlier))).toBeCloseTo(
      estimator.estimate(observations(clean)) as number,
    );
  });

  it("returns null when the lifts have no spread", () => {
    expect(estimator.estimate(observations([0.1, 0.1, 0.1, 0.1, 0.1]))).toBe(
      null,
    );
  });
});

// Lifts whose standardized values sit exactly on normal quantiles, so the
// sample behaves like a draw from N(0, tau^2 + se^2) without any randomness.
function quantileObservations(
  n: number,
  tau: number,
  standardError: (i: number) => number,
): LiftObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const se = standardError(i);
    // Spread the quantiles across observations so they don't sort with se
    const rank = (i * 7) % n;
    const z = normal.quantile((rank + 0.5) / n, 0, 1);
    return {
      experimentId: `exp_${i}`,
      lift: z * Math.sqrt(tau ** 2 + se ** 2),
      standardError: se,
    };
  });
}

describe("estimateTrueEffectScale", () => {
  it("recovers tau when every result has the same standard error", () => {
    const obs = quantileObservations(101, 0.05, () => 0.03);
    expect(estimateTrueEffectScale(withStandardErrors(obs), 0)).toBeCloseTo(
      0.05,
      2,
    );
  });

  it("recovers tau with heterogeneous standard errors", () => {
    const obs = quantileObservations(101, 0.05, (i) => 0.01 + (i % 5) * 0.02);
    expect(estimateTrueEffectScale(withStandardErrors(obs), 0)).toBeCloseTo(
      0.05,
      2,
    );
  });

  it("returns 0 when sampling noise explains all of the spread", () => {
    const obs = quantileObservations(101, 0, () => 0.05).map((o) => ({
      ...o,
      lift: o.lift / 2,
    }));
    expect(estimateTrueEffectScale(withStandardErrors(obs), 0)).toBe(0);
  });

  it("is not moved by the outliers it is meant to flag", () => {
    const obs = withStandardErrors(quantileObservations(101, 0.05, () => 0.03));
    const clean = estimateTrueEffectScale(obs, 0);
    const contaminated = estimateTrueEffectScale(
      obs.map((o, i) => (i < 5 ? { ...o, lift: 20 } : o)),
      0,
    );
    expect(contaminated / clean).toBeLessThan(1.25);
  });
});

describe("estimateTrueEffectsJamesStein", () => {
  it("is the total variance less the noise variance, centered on 0", () => {
    const obs = [-0.3, -0.1, 0.1, 0.2, 0.4].map((lift) => ({
      lift,
      standardError: 0.1,
    }));
    // Z = 0.31, so Z / (N - 2) - se^2 = 0.31 / 3 - 0.01
    const { center, tau } = estimateTrueEffectsJamesStein(obs);
    expect(center).toBe(0);
    expect(tau ** 2).toBeCloseTo(0.31 / 3 - 0.01);
  });

  it("agrees with the shrinkage factor used for scaled impact", () => {
    const obs = withStandardErrors(quantileObservations(101, 0.05, () => 0.03));
    const { tau } = estimateTrueEffectsJamesStein(obs);
    const { adjustment } = jamesSteinAdjustment(
      obs.map((o) => o.lift),
      0.03,
    );
    expect(tau).toBeCloseTo(0.05, 2);
    expect(1 - adjustment).toBeCloseTo(tau ** 2 / (tau ** 2 + 0.03 ** 2));
  });

  it("removes the average noise variance when standard errors differ", () => {
    const obs = withStandardErrors(
      quantileObservations(2001, 0.05, (i) => 0.01 + (i % 5) * 0.02),
    );
    expect(estimateTrueEffectsJamesStein(obs).tau).toBeCloseTo(0.05, 2);
  });

  it("returns 0 when the shrinkage is total", () => {
    const obs = withStandardErrors(
      quantileObservations(101, 0, () => 0.05).map((o) => ({
        ...o,
        lift: o.lift / 2,
      })),
    );
    expect(estimateTrueEffectsJamesStein(obs).tau).toBe(0);
  });

  it("is inflated by outliers that the median-based fit resists", () => {
    const obs = withStandardErrors(
      quantileObservations(101, 0.05, () => 0.03),
    ).map((o, i) => (i < 5 ? { ...o, lift: 20 } : o));
    expect(estimateTrueEffectsJamesStein(obs).tau).toBeGreaterThan(1);
    expect(estimateTrueEffectsMedian(obs).tau).toBeLessThan(0.07);
  });
});

describe("true effect scale estimator", () => {
  const estimator = suspiciousChangeEstimators["true-effect-scale"];
  const robust = suspiciousChangeEstimators["robust-scale"];

  it("sets a tighter threshold than the observed spread for a noisy metric", () => {
    // Noise (se 0.10) dominates true effects (tau 0.02): the type M regime.
    // tau^2 is 4% of the total variance here, so it takes a fine grid for the
    // quantiles to pin it down.
    const obs = quantileObservations(20001, 0.02, () => 0.1);
    const threshold = estimator.estimate(obs) as number;
    expect(threshold).toBeCloseTo(3 * 0.02, 2);
    expect(threshold).toBeLessThan((robust.estimate(obs) as number) / 3);
  });

  it("uses flat-prior values over shrunk ones", () => {
    const raw = quantileObservations(101, 0.05, () => 0.03);
    const shrunk = raw.map((o) => ({
      ...o,
      lift: o.lift / 4,
      standardError: (o.standardError as number) / 2,
      flatPrior: {
        lift: o.lift,
        standardError: o.standardError as number,
      },
    }));
    expect(estimator.estimate(shrunk)).toBeCloseTo(
      estimator.estimate(raw) as number,
    );
  });

  it("ignores observations without a usable standard error", () => {
    expect(estimator.isUsable?.({ experimentId: "e", lift: 0.1 })).toBe(false);
    expect(
      estimator.isUsable?.({ experimentId: "e", lift: 0.1, standardError: 0 }),
    ).toBe(false);
    const estimate = estimateSuspiciousChangeThreshold(
      observations([-0.2, -0.1, 0, 0.1, 0.2, 0.3, -0.3, 0.05, -0.05, 0.15]),
    );
    expect(estimate.estimator).toBe("true-effect-scale");
    expect(estimate.status).toBe("insufficient-history");
    expect(estimate.numObservations).toBe(0);
  });
});

describe("estimateSuspiciousChangeThreshold", () => {
  const estimatorId = "robust-scale";
  const { minObservations } = suspiciousChangeEstimators[estimatorId];
  const lifts = Array.from(
    { length: minObservations },
    (_, i) => (i - minObservations / 2) / 100,
  );

  it("reports insufficient history below the estimator minimum", () => {
    const estimate = estimateSuspiciousChangeThreshold(
      observations(lifts.slice(1)),
      { estimatorId },
    );
    expect(estimate.status).toBe("insufficient-history");
    expect(estimate.threshold).toBe(null);
    expect(estimate.minObservations).toBe(minObservations);
  });

  it("ignores non-finite lifts when counting history", () => {
    const estimate = estimateSuspiciousChangeThreshold(
      observations([...lifts.slice(1), NaN, Infinity]),
      { estimatorId },
    );
    expect(estimate.status).toBe("insufficient-history");
    expect(estimate.numObservations).toBe(minObservations - 1);
  });

  it("reports degenerate history", () => {
    const estimate = estimateSuspiciousChangeThreshold(
      observations(lifts.map(() => 0.05)),
      { estimatorId },
    );
    expect(estimate.status).toBe("degenerate");
    expect(estimate.threshold).toBe(null);
  });

  it("rounds the threshold up to 0.1% and counts distinct experiments", () => {
    const obs = observations(lifts).map((o, i) => ({
      ...o,
      experimentId: `exp_${Math.floor(i / 2)}`,
    }));
    const estimate = estimateSuspiciousChangeThreshold(obs, { estimatorId });
    const raw = suspiciousChangeEstimators[estimatorId].estimate(obs) as number;

    expect(estimate.status).toBe("success");
    expect(estimate.numExperiments).toBe(Math.ceil(minObservations / 2));
    expect(estimate.threshold).toBeGreaterThanOrEqual(raw);
    expect((estimate.threshold as number) - raw).toBeLessThan(0.001);
    expect(((estimate.threshold as number) * 1000) % 1).toBeCloseTo(0);
  });

  it("throws on an unknown estimator", () => {
    expect(() =>
      estimateSuspiciousChangeThreshold(observations(lifts), {
        estimatorId: "nope",
      }),
    ).toThrow("Unknown suspicious change estimator");
  });
});

describe("estimateSuspiciousChangeThresholdWithFallback", () => {
  const rich = quantileObservations(50, 0.05, () => 0.03);
  const organization = quantileObservations(50, 0.2, () => 0.03);
  const thin = rich.slice(0, 2);
  // Enough results, but noise explains their spread, so tau is 0
  const allNoise = quantileObservations(50, 0, () => 0.05).map((o) => ({
    ...o,
    lift: o.lift / 2,
  }));
  const withoutStandardErrors = rich.map((o) => ({
    ...o,
    standardError: undefined,
  }));

  it("prefers the metric's own true effect scale", () => {
    const estimate = estimateSuspiciousChangeThresholdWithFallback(
      rich,
      organization,
    );
    expect(estimate.source).toBe("metric");
    expect(estimate.estimator).toBe("true-effect-scale");
  });

  it("pools the organization before dropping to a weaker estimator", () => {
    for (const metricObservations of [thin, allNoise]) {
      const estimate = estimateSuspiciousChangeThresholdWithFallback(
        metricObservations,
        organization,
      );
      expect(estimate.source).toBe("organization");
      expect(estimate.estimator).toBe("true-effect-scale");
    }
  });

  it("falls back to the robust scale when there are no standard errors", () => {
    const estimate = estimateSuspiciousChangeThresholdWithFallback(
      withoutStandardErrors,
      withoutStandardErrors,
    );
    expect(estimate.source).toBe("metric");
    expect(estimate.estimator).toBe("robust-scale");
    expect(estimate.status).toBe("success");
  });

  it("uses only the metric when given no organization observations", () => {
    const estimate = estimateSuspiciousChangeThresholdWithFallback(
      allNoise,
      null,
    );
    expect(estimate.source).toBe("metric");
    expect(estimate.estimator).toBe("robust-scale");
  });

  it("reports the preferred estimator's status when nothing succeeds", () => {
    const estimate = estimateSuspiciousChangeThresholdWithFallback(thin, []);
    expect(estimate.status).toBe("insufficient-history");
    expect(estimate.estimator).toBe("true-effect-scale");
    expect(estimate.source).toBe("metric");
    expect(estimate.threshold).toBe(null);
  });
});

describe("getLiftObservationsFromSnapshot", () => {
  const stopped = { id: "exp_1", status: "stopped", type: "standard" };
  const snapshot = makeSnapshot([
    snapshotMetric({}),
    snapshotMetric({
      expected: 0.05,
      uplift: { dist: "normal", stddev: 0.02 },
    }),
    snapshotMetric({ expected: -0.03 }),
  ]);

  it("returns one observation per non-baseline variation", () => {
    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot,
        metrics: [metric],
        metricDefaults: {},
      }),
    ).toEqual([
      { experimentId: "exp_1", lift: 0.05, standardError: 0.02 },
      { experimentId: "exp_1", lift: -0.03, standardError: undefined },
    ]);
  });

  it("skips experiments that are not stopped standard experiments", () => {
    const args = { snapshot, metrics: [metric], metricDefaults: {} };
    expect(
      getLiftObservationsFromSnapshot({
        ...args,
        experiment: { ...stopped, status: "running" },
      }),
    ).toEqual([]);
    expect(
      getLiftObservationsFromSnapshot({
        ...args,
        experiment: { ...stopped, type: "multi-armed-bandit" },
      }),
    ).toEqual([]);
  });

  it("skips variations with errors or too little data", () => {
    const sparse = makeSnapshot([
      snapshotMetric({}),
      snapshotMetric({ expected: 0.05, errorMessage: "failed" }),
      snapshotMetric({ expected: 4, value: 10 }),
    ]);
    // hasEnoughData passes when either side reaches minSampleSize
    const allSparse = makeSnapshot([
      snapshotMetric({ value: 10 }),
      snapshotMetric({ expected: 4, value: 10 }),
    ]);
    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot: sparse,
        metrics: [metric],
        metricDefaults: {},
      }).map((o) => o.lift),
    ).toEqual([4]);
    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot: allSparse,
        metrics: [metric],
        metricDefaults: {},
      }),
    ).toEqual([]);
  });

  it("captures the flat-prior estimate when the lift was shrunk", () => {
    const bayesian = makeSnapshot([
      snapshotMetric({}),
      snapshotMetric({
        expected: 0.02,
        uplift: { dist: "normal", stddev: 0.01 },
        supplementalResults: {
          flatPrior: {
            ...snapshotMetric({}),
            expected: 0.08,
            uplift: { dist: "normal", mean: 0.08, stddev: 0.04 },
          } as NonNullable<SnapshotMetric["supplementalResults"]>["flatPrior"],
        },
      }),
    ]);
    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot: bayesian,
        metrics: [metric],
        metricDefaults: {},
      }),
    ).toEqual([
      {
        experimentId: "exp_1",
        lift: 0.02,
        standardError: 0.01,
        flatPrior: { lift: 0.08, standardError: 0.04 },
      },
    ]);
  });

  it("pools observations across the metrics it is given", () => {
    const other = {
      id: "fact__other",
      minSampleSize: 100,
    } as FactMetricInterface;
    const pooled = makeSnapshot([
      snapshotMetric({}),
      snapshotMetric({ expected: 0.05 }),
    ]);
    const variations = pooled.analyses[0].results[0].variations;
    variations[0].metrics[other.id] = snapshotMetric({});
    variations[1].metrics[other.id] = snapshotMetric({ expected: -0.2 });

    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot: pooled,
        metrics: [metric, other, { ...other, id: "fact__unused" }],
        metricDefaults: {},
      }).map((o) => o.lift),
    ).toEqual([0.05, -0.2]);
  });

  it("reads the relative analysis even when it is not the default", () => {
    const absoluteFirst = makeSnapshot(
      [snapshotMetric({}), snapshotMetric({ expected: 0.05 })],
      [{ ...settings, differenceType: "absolute" }, settings],
    );
    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot: absoluteFirst,
        metrics: [metric],
        metricDefaults: {},
      }),
    ).toHaveLength(1);

    const absoluteOnly = makeSnapshot(
      [snapshotMetric({}), snapshotMetric({ expected: 0.05 })],
      [{ ...settings, differenceType: "absolute" }],
    );
    expect(
      getLiftObservationsFromSnapshot({
        experiment: stopped,
        snapshot: absoluteOnly,
        metrics: [metric],
        metricDefaults: {},
      }),
    ).toEqual([]);
  });
});
