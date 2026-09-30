import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { SuspiciousChangeEstimate } from "shared/experiments";
import useApi from "@/hooks/useApi";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import { CreateFactMetricFormProps } from "@/services/metrics";

// Form values are whole-number percents; estimates are proportions
function toPercent(threshold: number): number {
  return Math.round(threshold * 1000) / 10;
}

export default function EmpiricalMaxPercentChange({
  form,
  metricId,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  metricId?: string;
}) {
  const { data } = useApi<{ estimate: SuspiciousChangeEstimate }>(
    `/metrics/${metricId}/suspicious-change-threshold`,
    { shouldRun: () => !!metricId },
  );
  const estimate = data?.estimate;
  const suggested =
    estimate && estimate.threshold !== null
      ? toPercent(estimate.threshold)
      : null;

  const empirical = form.watch("maxPercentChangeMode") === "empirical";

  useEffect(() => {
    if (empirical && suggested !== null) {
      form.setValue("maxPercentChange", suggested);
    }
  }, [empirical, suggested, form]);

  const historyText = !metricId
    ? "Until this metric has enough past experiments, the threshold comes from lifts across all metrics, or the value above if there are too few of those."
    : !estimate
      ? "Loading past experiments…"
      : estimate.status !== "success"
        ? estimate.status === "insufficient-history"
          ? `Only ${estimate.numObservations} of the ${estimate.minObservations} variation results needed were found in stopped experiments, for this metric or across all metrics. The value above is used until there are enough.`
          : "Past lifts are too similar to estimate a threshold. The value above is used instead."
        : estimate.source === "organization"
          ? `This metric has too few past experiments, so this is based on ${estimate.numObservations} variation results across all metrics in ${estimate.numExperiments} recent stopped experiments.`
          : `Based on ${estimate.numObservations} variation results from ${estimate.numExperiments} stopped experiments.`;

  return (
    <Box mb="3">
      <Checkbox
        label="Set max percent change from past experiments"
        value={empirical}
        setValue={(v) =>
          form.setValue(
            "maxPercentChangeMode",
            v === true ? "empirical" : "manual",
          )
        }
        description={
          empirical
            ? `Updated whenever an experiment using this metric is stopped. ${historyText}`
            : "Keep this threshold in line with the lifts seen in past experiments."
        }
      />
      {!empirical && suggested !== null ? (
        <Button
          variant="ghost"
          size="sm"
          mt="1"
          onClick={() => form.setValue("maxPercentChange", suggested)}
        >
          Use suggested value ({suggested}%
          {estimate?.source === "organization" ? ", from all metrics" : ""})
        </Button>
      ) : null}
    </Box>
  );
}
