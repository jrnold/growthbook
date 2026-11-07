import { ExposureQuery } from "shared/types/datasource";
import { FactMetricInterface } from "shared/types/fact-table";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import BigQuery from "back-end/src/integrations/BigQuery";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";
import {
  chunkMetrics,
  getNonQuantileNonFunnelFloatColumns,
} from "back-end/src/services/experimentQueries/experimentQueries";
import { getAdditionalExperimentAnalysisSettings } from "back-end/src/services/experiments";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

const testExposureQuery: ExposureQuery = {
  id: "user_id",
  name: "Exposure",
  description: "Exposure",
  query: "SELECT user_id, timestamp, variation_id FROM exposures",
  userIdType: "user_id",
  dimensions: [],
};

const ordersFactTable = factTableFactory.build({
  id: "orders",
  name: "Orders",
  sql: "SELECT user_id, timestamp, amount FROM orders",
});
const savedCartsFactTable = factTableFactory.build({
  id: "saved_carts",
  name: "Saved Carts",
  sql: "SELECT user_id, timestamp FROM saved_carts",
});
const factTableMap = new Map([
  [ordersFactTable.id, ordersFactTable],
  [savedCartsFactTable.id, savedCartsFactTable],
]);

const revenue = factMetricFactory.build({
  id: "fact__revenue",
  metricType: "mean",
  numerator: { factTableId: "orders", column: "amount", aggregation: "sum" },
});
const ordersPerSession = factMetricFactory.build({
  id: "fact__ratio",
  metricType: "ratio",
  numerator: { factTableId: "orders", column: "amount", aggregation: "sum" },
  denominator: {
    factTableId: "orders",
    column: "$$count",
    aggregation: "sum",
  },
});
const savedCart = factMetricFactory.build({
  id: "fact__saved_cart",
  metricType: "proportion",
  numerator: {
    factTableId: "saved_carts",
    column: "$$distinctUsers",
    aggregation: "sum",
  },
});

// @ts-expect-error -- context is not needed to read `.datasource`
const bqIntegration = new BigQuery("", {
  type: "bigquery",
  settings: { queries: { exposure: [testExposureQuery] } },
});

const settings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 0,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure" as const,
  experimentId: "exp",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "",
  exposureQueryId: "user_id",
  startDate: new Date("2023-01-01"),
  endDate: new Date("2023-01-31"),
  variations: [],
};

function buildSql(
  metrics: FactMetricInterface[],
  takeUpMetric: FactMetricInterface | null,
): string {
  const snapshotSettings = {
    ...settings,
    takeUpMetric: takeUpMetric?.id ?? null,
  };
  return getExperimentFactMetricsQuery(
    bigQueryDialect,
    bqIntegration.datasource,
    {
      settings: snapshotSettings,
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(snapshotSettings, {
        query: testExposureQuery.query,
        userIdType: testExposureQuery.userIdType,
      }),
      activationMetric: null,
      takeUpMetric,
      dimensions: [],
      segment: null,
      metrics,
      factTableMap,
    },
  );
}

function flatten(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("take-up metric SQL", () => {
  it("adds take-up moments to eligible metrics only", () => {
    const sql = flatten(buildSql([revenue, ordersPerSession], savedCart));

    expect(sql).toContain("__takeUpMetric as (");
    expect(sql).toContain("AS first_take_up_timestamp");
    expect(sql).toMatch(/first_take_up_timestamp IS NOT NULL.*AS take_up/);
    expect(sql).toContain(
      "LEFT JOIN __distinctUsers tu ON (tu.user_id = m.user_id)",
    );

    expect(sql).toContain("SUM(COALESCE(tu.take_up, 0)) AS m0_denominator_sum");
    expect(sql).toContain("AS m0_main_denominator_sum_product");
    expect(sql).toContain("AS m0_main_squared_denominator_sum_product");

    // The ratio metric keeps its own denominator and gets no IV columns
    expect(sql).toContain("AS m1_denominator_sum");
    expect(sql).not.toContain("m1_main_squared_denominator_sum_product");
  });

  it("measures take-up over the experiment period", () => {
    const sql = flatten(buildSql([revenue], savedCart));
    expect(sql).toMatch(
      /t\.timestamp >= e\.timestamp AND t\.timestamp <= '2023-01-31 00:00:00'/,
    );
  });

  it("leaves the query unchanged without a take-up metric", () => {
    const sql = buildSql([revenue], null);
    expect(sql).not.toContain("take_up");
    expect(sql).not.toContain("main_squared_denominator_sum_product");
  });

  it("rejects take-up metrics in bandits", () => {
    const snapshotSettings = {
      ...settings,
      takeUpMetric: savedCart.id,
      banditSettings: {
        reweight: true,
        decisionMetric: revenue.id,
        seed: 1,
        currentWeights: [0.5, 0.5],
        historicalWeights: [],
      },
    };
    expect(() =>
      getExperimentFactMetricsQuery(bigQueryDialect, bqIntegration.datasource, {
        settings: snapshotSettings,
        unitsSource: "exposureQuery",
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(snapshotSettings, {
          query: testExposureQuery.query,
          userIdType: testExposureQuery.userIdType,
        }),
        activationMetric: null,
        takeUpMetric: savedCart,
        dimensions: [],
        segment: null,
        metrics: [revenue],
        factTableMap,
      }),
    ).toThrow("Take-up metrics are not supported in Bandit experiments");
  });

  it("adds the take-up column to a materialized units query", () => {
    const sql = flatten(
      getExperimentUnitsQuery(postgresDialect, bqIntegration.datasource, {
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(
          { ...settings, takeUpMetric: savedCart.id },
          {
            query: testExposureQuery.query,
            userIdType: testExposureQuery.userIdType,
          },
        ),
        activationMetric: null,
        takeUpMetric: savedCart,
        factTableMap,
        dimensions: [],
        segment: null,
        includeIdJoins: true,
      }),
    );
    expect(sql).toContain(
      "LEFT JOIN __takeUpMetric t ON (t.user_id = e.user_id)",
    );
    expect(sql).toContain("AS first_take_up_timestamp");
  });
});

describe("take-up column budget", () => {
  it("counts take-up columns only when the metric gets them", () => {
    const base = getNonQuantileNonFunnelFloatColumns({
      metric: revenue,
      regressionAdjusted: false,
      isBandit: false,
    });
    const withTakeUp = getNonQuantileNonFunnelFloatColumns({
      metric: revenue,
      regressionAdjusted: false,
      isBandit: false,
      takeUp: true,
    });
    expect(withTakeUp).toEqual(
      expect.arrayContaining([
        ...base,
        "denominator_sum",
        "main_squared_denominator_sum_product",
      ]),
    );
    expect(
      getNonQuantileNonFunnelFloatColumns({
        metric: ordersPerSession,
        regressionAdjusted: false,
        isBandit: false,
        takeUp: true,
      }),
    ).not.toContain("main_squared_denominator_sum_product");
  });

  it("splits chunks sooner when take-up columns are added", () => {
    const metrics = Array.from({ length: 20 }, (_, i) => ({
      metric: { ...revenue, id: `fact__m${i}` },
      regressionAdjusted: false,
    }));
    const maxColumnsPerQuery = 103 + 20 * 5;
    expect(
      chunkMetrics({ metrics, maxColumnsPerQuery, isBandit: false }),
    ).toHaveLength(1);
    expect(
      chunkMetrics({
        metrics: metrics.map((m) => ({ ...m, takeUp: true })),
        maxColumnsPerQuery,
        isBandit: false,
      }).length,
    ).toBeGreaterThan(1);
  });
});

describe("getAdditionalExperimentAnalysisSettings", () => {
  const defaults = {
    dimensions: [],
    statsEngine: "frequentist" as const,
    differenceType: "relative" as const,
    numGoalMetrics: 1,
    numGuardrailMetrics: 0,
  };

  it("precomputes relative and absolute CACE when a take-up metric is set", () => {
    const cace = getAdditionalExperimentAnalysisSettings(defaults, {
      takeUpMetric: savedCart.id,
    }).filter((a) => a.effectType === "cace");
    expect(cace.map((a) => a.differenceType)).toEqual(["relative", "absolute"]);
  });

  it("adds no CACE analyses without a take-up metric", () => {
    expect(
      getAdditionalExperimentAnalysisSettings(defaults).some(
        (a) => a.effectType === "cace",
      ),
    ).toBe(false);
  });
});
