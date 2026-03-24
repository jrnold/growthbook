// Sequential SRM integration helpers.
// Consolidates all SRM-related logic so upstream util/stats.ts and
// services/stats.ts stay close to upstream.

import { EXPOSURE_DATE_DIMENSION_NAME } from "shared/constants";
import { ExperimentAggregateUnitsQueryResponseRows } from "shared/types/integrations";
import {
  ExperimentSnapshotAnalysisSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import { checkSrm } from "back-end/src/util/stats";
import { sequentialPValues } from "back-end/src/util/ssrm";

/**
 * SRM settings needed by the traffic/dimension SRM helpers.
 * Extracted from ExperimentSnapshotAnalysisSettings.
 */
export interface SrmSettings {
  srmMethod: "chi_squared" | "sequential";
  srmSlabWeight: number;
  srmDirichletConcentration: number;
}

const DEFAULT_SRM_SETTINGS: SrmSettings = {
  srmMethod: "chi_squared",
  srmSlabWeight: 0.0,
  srmDirichletConcentration: 10000.0,
};

/**
 * Build a sorted daily matrix (rows=days, cols=variations) from raw traffic
 * query rows. Only rows with dimension_name === EXPOSURE_DATE_DIMENSION_NAME
 * are used.
 */
export function extractSrmDailyUsers(
  rows: ExperimentAggregateUnitsQueryResponseRows | undefined,
  variations: SnapshotSettingsVariation[],
): number[][] {
  if (!rows?.length) return [];
  const variationIdMap: Record<string, number> = {};
  variations.forEach((v, i) => {
    variationIdMap[v.id] = i;
  });

  const byDate = new Map<string, number[]>();
  rows.forEach((r) => {
    if (r.dimension_name !== EXPOSURE_DATE_DIMENSION_NAME) return;
    const varIdx = variationIdMap[r.variation];
    if (varIdx === undefined) return;
    const units =
      byDate.get(r.dimension_value) ?? Array(variations.length).fill(0);
    units[varIdx] = r.units;
    byDate.set(r.dimension_value, units);
  });

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, units]) => units);
}

/**
 * Compute an SRM p-value from a 2D daily matrix (rows=days, cols=variations).
 * Dispatches to sequential or chi-squared based on settings.
 */
function computeSrmFromDailyMatrix(
  dailyUsers: number[][],
  weights: number[],
  settings: SrmSettings,
): number {
  if (settings.srmMethod === "sequential" && dailyUsers.length > 0) {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const validIndices = weights
      .map((w, i) => (w > 0 ? i : -1))
      .filter((i) => i >= 0);
    const nullProbs = validIndices.map((i) => weights[i] / totalWeight);
    const filtered = dailyUsers.map((row) => validIndices.map((i) => row[i]));
    if (!filtered.some((row) => row.reduce((a, b) => a + b, 0) > 0)) {
      return 1.0;
    }
    const pValues = sequentialPValues(filtered, nullProbs, {
      slabWeight: settings.srmSlabWeight,
      dirichletConcentration: settings.srmDirichletConcentration,
    });
    return pValues[pValues.length - 1] ?? 1.0;
  }

  // Chi-squared: aggregate daily rows to totals
  const totalUsers = Array(weights.length).fill(0) as number[];
  dailyUsers.forEach((row) => row.forEach((u, i) => (totalUsers[i] += u)));
  return checkSrm(totalUsers, weights);
}

/**
 * Aggregate daily traffic data to totals and run SRM check.
 * When settings specify sequential, runs the sequential test on daily data.
 */
export function checkSrmFromTimeSeries(
  dailyData: { variationUnits: number[] }[],
  weights: number[],
  settings: SrmSettings = DEFAULT_SRM_SETTINGS,
): number {
  if (settings.srmMethod === "sequential" && dailyData.length > 0) {
    const dailyMatrix = dailyData.map((d) => d.variationUnits);
    return computeSrmFromDailyMatrix(dailyMatrix, weights, settings);
  }
  // Chi-squared fallback
  const totalUsers = Array(weights.length).fill(0) as number[];
  dailyData.forEach((d) =>
    d.variationUnits.forEach((u, i) => {
      totalUsers[i] += u;
    }),
  );
  return checkSrm(totalUsers, weights);
}

/**
 * Extract SRM-related settings for the stats engine.
 */
export function getSrmSettingsForStatsEngine(
  settings: ExperimentSnapshotAnalysisSettings,
): {
  srm_method: "chi_squared" | "sequential";
  srm_slab_weight: number;
  srm_dirichlet_concentration: number;
} {
  return {
    srm_method: settings.srmMethod ?? "chi_squared",
    srm_slab_weight: settings.srmSlabWeight ?? 0.0,
    srm_dirichlet_concentration: settings.srmDirichletConcentration ?? 10000.0,
  };
}

/**
 * Extract SrmSettings from analysis settings for use in traffic/dimension SRM.
 * Accepts any object with the optional SRM fields (works with both
 * ExperimentSnapshotAnalysisSettings and SafeRollout analysis settings).
 */
export function extractSrmSettings(
  settings:
    | {
        srmMethod?: "chi_squared" | "sequential";
        srmSlabWeight?: number;
        srmDirichletConcentration?: number;
      }
    | undefined,
): SrmSettings {
  if (!settings) return DEFAULT_SRM_SETTINGS;
  return {
    srmMethod: settings.srmMethod ?? "chi_squared",
    srmSlabWeight: settings.srmSlabWeight ?? 0.0,
    srmDirichletConcentration: settings.srmDirichletConcentration ?? 10000.0,
  };
}

/**
 * Extract daily users from query data for SRM computation.
 */
export function getSrmDailyUsersFromQueryData(
  queryData: Map<string, { result?: unknown }>,
  variations: SnapshotSettingsVariation[],
): number[][] {
  const trafficRows = queryData.get("traffic")?.result as
    | ExperimentAggregateUnitsQueryResponseRows
    | undefined;
  return extractSrmDailyUsers(trafficRows, variations);
}

/**
 * Compute traffic-level SRM: uses daily time-series when available.
 * When sequential is configured but no daily data exists, wraps
 * aggregated totals as a single-row matrix so the sequential test
 * still runs.
 */
export function computeTrafficSrm(
  overallVariationUnits: number[],
  dailyEntries: { variationUnits: number[] }[],
  variationWeights: number[],
  settings: SrmSettings = DEFAULT_SRM_SETTINGS,
): number {
  if (dailyEntries.length > 0) {
    return checkSrmFromTimeSeries(dailyEntries, variationWeights, settings);
  }
  // No daily data — for sequential, wrap aggregated totals as single row
  if (settings.srmMethod === "sequential") {
    return computeSrmFromDailyMatrix(
      [overallVariationUnits],
      variationWeights,
      settings,
    );
  }
  return checkSrm(overallVariationUnits, variationWeights);
}

/**
 * Compute SRM for a single dimension slice.
 * For sequential, wraps aggregated counts as a single-row matrix so the
 * sequential test runs on the final aggregate (last value) only.
 */
export function computeDimensionSrm(
  variationUnits: number[],
  variationWeights: number[],
  settings: SrmSettings = DEFAULT_SRM_SETTINGS,
): number {
  if (settings.srmMethod === "sequential") {
    return computeSrmFromDailyMatrix(
      [variationUnits],
      variationWeights,
      settings,
    );
  }
  return checkSrm(variationUnits, variationWeights);
}

/**
 * Compute cumulative sequential p-values for each day in a sorted daily
 * matrix. Returns an array of p-values (one per row) where entry i is
 * the sequential p-value using data from rows 0..i.
 *
 * For chi-squared, each day gets an independent chi-squared p-value
 * on its own counts (matching the existing per-day behavior).
 */
export function computePerDaySequentialSrm(
  dailyMatrix: number[][],
  weights: number[],
  settings: SrmSettings,
): number[] {
  if (settings.srmMethod !== "sequential" || dailyMatrix.length === 0) {
    // Chi-squared: each day independently
    return dailyMatrix.map((row) => checkSrm(row, weights));
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const validIndices = weights
    .map((w, i) => (w > 0 ? i : -1))
    .filter((i) => i >= 0);
  const nullProbs = validIndices.map((i) => weights[i] / totalWeight);
  const filtered = dailyMatrix.map((row) => validIndices.map((i) => row[i]));

  if (!filtered.some((row) => row.reduce((a, b) => a + b, 0) > 0)) {
    return dailyMatrix.map(() => 1.0);
  }

  return sequentialPValues(filtered, nullProbs, {
    slabWeight: settings.srmSlabWeight,
    dirichletConcentration: settings.srmDirichletConcentration,
  });
}
