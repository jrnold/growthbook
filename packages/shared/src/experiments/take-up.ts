import type { EffectType } from "shared/types/stats";
import {
  ExperimentMetricDefinition,
  isBinomialMetric,
  isFactMetric,
} from "./experiments";

// Per-user outcomes that the Wald estimator can divide by the take-up
// difference. Ratio, quantile and funnel metrics need their own estimators.
const TAKE_UP_ELIGIBLE_METRIC_TYPES = [
  "mean",
  "proportion",
  "retention",
  "dailyParticipation",
];

export function isTakeUpEligibleMetric(m: ExperimentMetricDefinition): boolean {
  return (
    isFactMetric(m) && TAKE_UP_ELIGIBLE_METRIC_TYPES.includes(m.metricType)
  );
}

// Take-up is whether a user has any matching event, so only yes-or-no metrics
// make sense as its definition.
export function isValidTakeUpMetric(m: ExperimentMetricDefinition): boolean {
  if (isFactMetric(m)) return m.metricType === "proportion";
  return isBinomialMetric(m);
}

export function getEffectType({
  takeUpMetric,
  effectType,
}: {
  takeUpMetric?: string | null;
  effectType?: EffectType;
}): EffectType {
  return takeUpMetric && effectType === "cace" ? "cace" : "itt";
}

export function usesTakeUpEffect(
  settings: { takeUpMetric?: string | null; effectType?: EffectType },
  metric: ExperimentMetricDefinition,
): boolean {
  return getEffectType(settings) === "cace" && isTakeUpEligibleMetric(metric);
}
