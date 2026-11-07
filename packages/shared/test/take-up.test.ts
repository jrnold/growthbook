import {
  ExperimentMetricDefinition,
  getEffectType,
  isTakeUpEligibleMetric,
  isValidTakeUpMetric,
  usesTakeUpEffect,
} from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";

function factMetric(metricType: string): ExperimentMetricDefinition {
  return {
    id: `fact__${metricType}`,
    name: metricType,
    metricType,
  } as unknown as FactMetricInterface;
}

function legacyMetric(type: string): ExperimentMetricDefinition {
  return { id: `met_${type}`, name: type, type } as ExperimentMetricDefinition;
}

describe("isTakeUpEligibleMetric", () => {
  it.each(["mean", "proportion", "retention", "dailyParticipation"])(
    "accepts %s fact metrics",
    (metricType) => {
      expect(isTakeUpEligibleMetric(factMetric(metricType))).toBe(true);
    },
  );

  it.each(["ratio", "quantile", "funnel"])(
    "rejects %s fact metrics",
    (metricType) => {
      expect(isTakeUpEligibleMetric(factMetric(metricType))).toBe(false);
    },
  );

  it("rejects legacy metrics", () => {
    expect(isTakeUpEligibleMetric(legacyMetric("count"))).toBe(false);
  });
});

describe("isValidTakeUpMetric", () => {
  it("accepts proportion fact metrics and binomial legacy metrics", () => {
    expect(isValidTakeUpMetric(factMetric("proportion"))).toBe(true);
    expect(isValidTakeUpMetric(legacyMetric("binomial"))).toBe(true);
  });

  it("rejects metrics that are not yes-or-no per user", () => {
    expect(isValidTakeUpMetric(factMetric("mean"))).toBe(false);
    expect(isValidTakeUpMetric(factMetric("retention"))).toBe(false);
    expect(isValidTakeUpMetric(factMetric("funnel"))).toBe(false);
    expect(isValidTakeUpMetric(legacyMetric("count"))).toBe(false);
  });
});

describe("getEffectType", () => {
  it("is cace only when a take-up metric is set", () => {
    expect(getEffectType({ takeUpMetric: "fact__a", effectType: "cace" })).toBe(
      "cace",
    );
    expect(getEffectType({ takeUpMetric: null, effectType: "cace" })).toBe(
      "itt",
    );
    expect(getEffectType({ takeUpMetric: "fact__a" })).toBe("itt");
  });
});

describe("usesTakeUpEffect", () => {
  const settings = { takeUpMetric: "fact__a", effectType: "cace" as const };

  it("applies to eligible metrics under cace", () => {
    expect(usesTakeUpEffect(settings, factMetric("mean"))).toBe(true);
  });

  it("falls back to itt for ineligible metrics", () => {
    expect(usesTakeUpEffect(settings, factMetric("ratio"))).toBe(false);
  });

  it("is off under itt", () => {
    expect(
      usesTakeUpEffect({ ...settings, effectType: "itt" }, factMetric("mean")),
    ).toBe(false);
  });
});
