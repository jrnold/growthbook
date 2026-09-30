import {
  DEFAULT_SUSPICIOUS_CHANGE_ESTIMATORS,
  ExperimentMetricDefinition,
  LiftObservation,
  SuspiciousChangeEstimate,
  estimateSuspiciousChangeThresholdWithFallback,
  getAllMetricIdsFromExperiment,
  getLiftObservationsFromSnapshot,
  isFactMetricId,
} from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { FactMetricInterface } from "shared/types/fact-table";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import {
  getAllExperiments,
  getExperimentsUsingMetric,
} from "back-end/src/models/ExperimentModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { logger } from "back-end/src/util/logger";
import { _getSnapshots } from "./experiments";
import { getContextForAgendaJobByOrgObject } from "./organizations";

// The pooled fallback hydrates every metric of each snapshot, so bound it to
// the most recent experiments.
const MAX_ORGANIZATION_EXPERIMENTS = 200;

async function getLiftObservations(
  context: ReqContext | ApiReqContext,
  experiments: ExperimentInterface[],
  metrics: ExperimentMetricDefinition[],
  hydrateMetricIds?: string[],
): Promise<LiftObservation[]> {
  const stopped = experiments.filter(
    (e) => e.status === "stopped" && e.phases.length > 0,
  );
  if (!stopped.length) return [];

  const snapshots = await _getSnapshots(
    context,
    stopped,
    undefined,
    true,
    hydrateMetricIds,
  );
  const snapshotsByExperiment = new Map(
    snapshots.map((s) => [s.experiment, s]),
  );
  const metricDefaults = context.org.settings?.metricDefaults ?? {};

  return stopped.flatMap((experiment) => {
    const snapshot = snapshotsByExperiment.get(experiment.id);
    return snapshot
      ? getLiftObservationsFromSnapshot({
          experiment,
          snapshot,
          metrics,
          metricDefaults,
        })
      : [];
  });
}

async function getOrganizationLiftObservations(
  context: ReqContext | ApiReqContext,
): Promise<LiftObservation[]> {
  const experiments = await getAllExperiments(context, {
    status: "stopped",
    type: "standard",
    sortBy: { _id: -1 },
    limit: MAX_ORGANIZATION_EXPERIMENTS,
  });
  const metricMap = await getMetricMap(context);
  return getLiftObservations(
    context,
    experiments,
    Array.from(metricMap.values()),
  );
}

export async function computeSuspiciousChangeThreshold(
  context: ReqContext | ApiReqContext,
  metric: ExperimentMetricDefinition,
  {
    fallbackToOrganization = true,
    getOrganizationObservations = () =>
      getOrganizationLiftObservations(context),
  }: {
    fallbackToOrganization?: boolean;
    // Lets a caller refreshing several metrics share one pooled fetch
    getOrganizationObservations?: () => Promise<LiftObservation[]>;
  } = {},
): Promise<SuspiciousChangeEstimate> {
  const experiments = await getExperimentsUsingMetric({
    context,
    metricId: metric.id,
  });
  const metricObservations = await getLiftObservations(
    context,
    experiments,
    [metric],
    [metric.id],
  );

  const metricOnly = estimateSuspiciousChangeThresholdWithFallback(
    metricObservations,
    null,
  );
  // The pooled fetch is expensive; skip it when the metric's own history
  // already satisfies the preferred estimator.
  const preferred =
    metricOnly.status === "success" &&
    metricOnly.estimator === DEFAULT_SUSPICIOUS_CHANGE_ESTIMATORS[0];
  if (preferred || !fallbackToOrganization) return metricOnly;

  return estimateSuspiciousChangeThresholdWithFallback(
    metricObservations,
    await getOrganizationObservations(),
  );
}

// Both refreshes run as the organization rather than the acting user so the
// threshold does not depend on which Projects that person can read.
export async function refreshEmpiricalThresholdForMetric(
  context: ReqContext | ApiReqContext,
  metric: FactMetricInterface,
  getOrganizationObservations?: () => Promise<LiftObservation[]>,
): Promise<void> {
  try {
    if (metric.maxPercentChangeMode !== "empirical") return;
    const orgContext = getContextForAgendaJobByOrgObject(context.org);
    const estimate = await computeSuspiciousChangeThreshold(
      orgContext,
      metric,
      { getOrganizationObservations },
    );
    if (estimate.threshold === null) return;
    await orgContext.models.factMetrics.setEmpiricalMaxPercentChange(
      metric.id,
      estimate.threshold,
    );
  } catch (e) {
    logger.error(
      e,
      `Failed to refresh empirical suspicious change threshold for metric ${metric.id}`,
    );
  }
}

export async function refreshEmpiricalThresholdsForExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<void> {
  try {
    const orgContext = getContextForAgendaJobByOrgObject(context.org);
    const metricGroups = await orgContext.models.metricGroups.getAll();
    const factMetricIds = getAllMetricIdsFromExperiment(
      experiment,
      false,
      metricGroups,
    ).filter(isFactMetricId);

    let organizationObservations: Promise<LiftObservation[]> | null = null;
    const getOrganizationObservations = () =>
      (organizationObservations ??=
        getOrganizationLiftObservations(orgContext));

    for (const id of factMetricIds) {
      const metric = await orgContext.models.factMetrics.getById(id);
      if (metric) {
        await refreshEmpiricalThresholdForMetric(
          orgContext,
          metric,
          getOrganizationObservations,
        );
      }
    }
  } catch (e) {
    logger.error(
      e,
      `Failed to refresh empirical suspicious change thresholds for experiment ${experiment.id}`,
    );
  }
}
