import dataclasses
import json
from pathlib import Path
from typing import List, Tuple
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd

from gbstats.gbstats import analyze_metric_df, get_metric_dfs
from gbstats.bayesian.tests import EffectBayesianABTest, EffectBayesianConfig
from gbstats.frequentist.tests import (
    FrequentistConfig,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
)
from gbstats.messages import (
    IV_RELATIVE_MISSING_STATISTIC_MESSAGE,
    IV_NO_TAKE_UP_DIFFERENCE_MESSAGE,
)
from gbstats.models.results import FrequentistVariationResponseIndividual
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    DifferenceType,
    MetricSettingsForStatsEngine,
)
from gbstats.models.statistics import (
    InstrumentalVariableStatistic,
    ProportionStatistic,
    RatioStatistic,
    SampleMeanStatistic,
    TestStatistic,
)
from gbstats.models.tests import (
    EffectMoments,
    EffectMomentsConfig,
    EffectMomentsIV,
)

# Shared with any future TypeScript port: it must reproduce the same numbers.
FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "iv_cases.json").read_text()
)["cases"]
ABSOLUTE = EffectMomentsConfig(difference_type="absolute")
RELATIVE = EffectMomentsConfig(difference_type="relative")
STRONG_CASES = [c for c in FIXTURES if c["name"] != "weak_instrument"]
Pairs = List[Tuple[TestStatistic, TestStatistic]]


def stat_from_fixture(case: dict, arm: str) -> InstrumentalVariableStatistic:
    s = case[f"stat_{arm}"]
    if case["outcome_type"] == "binomial":
        outcome = ProportionStatistic(n=s["n"], sum=s["y_sum"])
    else:
        outcome = SampleMeanStatistic(
            n=s["n"], sum=s["y_sum"], sum_squares=s["y_sum_squares"]
        )
    return InstrumentalVariableStatistic(
        n=s["n"],
        m_statistic=outcome,
        d_statistic=ProportionStatistic(n=s["n"], sum=s["d_sum"]),
        m_d_sum_of_products=s["y_d_sum_product"],
        m_squared_d_sum=s["y_squared_d_sum_product"],
    )


def arms_for(
    name: str,
) -> Tuple[dict, InstrumentalVariableStatistic, InstrumentalVariableStatistic]:
    case = next(c for c in FIXTURES if c["name"] == name)
    return case, stat_from_fixture(case, "a"), stat_from_fixture(case, "b")


def stats_for(name: str) -> Tuple[dict, Pairs]:
    case, stat_a, stat_b = arms_for(name)
    return case, [(stat_a, stat_b)]


def without_adopter_sum_squares(name: str) -> Tuple[dict, Pairs]:
    case, stat_a, stat_b = arms_for(name)
    return case, [
        (
            dataclasses.replace(stat_a, m_squared_d_sum=None),
            dataclasses.replace(stat_b, m_squared_d_sum=None),
        )
    ]


class TestEffectMomentsIV(TestCase):
    def test_matches_fixtures(self):
        for case in FIXTURES:
            if case["name"] == "weak_instrument":
                continue
            with self.subTest(case=case["name"]):
                _, stats = stats_for(case["name"])
                result = EffectMomentsIV(stats, ABSOLUTE).compute_result()
                self.assertIsNone(result.error_message)
                np.testing.assert_allclose(
                    result.point_estimate,
                    case["expected"]["point_estimate"],
                    rtol=1e-9,
                )
                np.testing.assert_allclose(
                    result.standard_error,
                    case["expected"]["standard_error"],
                    rtol=1e-9,
                )

    def test_agrees_with_2sls(self):
        for case in FIXTURES:
            if case["name"] == "weak_instrument":
                continue
            with self.subTest(case=case["name"]):
                _, stats = stats_for(case["name"])
                result = EffectMomentsIV(stats, ABSOLUTE).compute_result()
                np.testing.assert_allclose(
                    result.standard_error,
                    case["reference_2sls_hc0_standard_error"],
                    rtol=1e-3,
                )

    def test_weak_instrument_is_flagged_not_suppressed(self):
        case, stats = stats_for("weak_instrument")
        result = EffectMomentsIV(stats, ABSOLUTE).compute_result()
        self.assertIsNone(result.error_message)
        self.assertTrue(result.weak_instrument)
        assert result.first_stage_f is not None
        np.testing.assert_allclose(
            result.first_stage_f, case["expected"]["first_stage_f"]
        )
        np.testing.assert_allclose(
            result.point_estimate, case["expected"]["point_estimate"]
        )
        np.testing.assert_allclose(
            result.standard_error, case["expected"]["standard_error"]
        )

    def test_strong_instrument_is_not_flagged(self):
        for case in STRONG_CASES:
            with self.subTest(case=case["name"]):
                _, stats = stats_for(case["name"])
                result = EffectMomentsIV(stats, ABSOLUTE).compute_result()
                self.assertFalse(result.weak_instrument)
                assert result.first_stage_f is not None
                np.testing.assert_allclose(
                    result.first_stage_f, case["expected"]["first_stage_f"]
                )

    def test_no_take_up_difference_is_an_error(self):
        _, _, stat_b = arms_for("one_sided_noncompliance")
        result = EffectMomentsIV([(stat_b, stat_b)], ABSOLUTE).compute_result()
        self.assertEqual(result.error_message, IV_NO_TAKE_UP_DIFFERENCE_MESSAGE)

    def test_full_compliance_reduces_to_difference_in_means(self):
        def arm(n, y_sum, y_sum_squares, takes_up):
            d_sum = n if takes_up else 0
            return InstrumentalVariableStatistic(
                n=n,
                m_statistic=SampleMeanStatistic(
                    n=n, sum=y_sum, sum_squares=y_sum_squares
                ),
                d_statistic=ProportionStatistic(n=n, sum=d_sum),
                m_d_sum_of_products=y_sum if takes_up else 0,
            )

        stat_a = arm(3407, 1396.87, 52377.9767, False)
        stat_b = arm(3461, 2422.7, 134698.29, True)
        result = EffectMomentsIV([(stat_a, stat_b)], ABSOLUTE).compute_result()
        itt = EffectMoments(
            [(stat_a.m_statistic, stat_b.m_statistic)], ABSOLUTE
        ).compute_result()
        self.assertIsNone(result.error_message)
        np.testing.assert_allclose(result.point_estimate, itt.point_estimate)
        np.testing.assert_allclose(result.standard_error, itt.standard_error)

    def test_swapping_arms_keeps_the_estimate(self):
        case, stat_a, stat_b = arms_for("two_sided_unequal_arms")
        result = EffectMomentsIV([(stat_b, stat_a)], ABSOLUTE).compute_result()
        self.assertIsNone(result.error_message)
        np.testing.assert_allclose(
            result.point_estimate, case["expected"]["point_estimate"]
        )
        np.testing.assert_allclose(
            result.standard_error, case["expected"]["standard_error"]
        )

    def test_take_up_must_be_binary(self):
        with self.assertRaises(ValueError):
            InstrumentalVariableStatistic(
                n=10,
                m_statistic=SampleMeanStatistic(n=10, sum=5, sum_squares=9),
                d_statistic=SampleMeanStatistic(n=10, sum=5, sum_squares=9),
                m_d_sum_of_products=4,
            )

    def test_sum_keeps_type(self):
        _, stat_a, stat_b = arms_for("one_sided_noncompliance")
        summed = stat_a + stat_b
        self.assertIsInstance(summed, InstrumentalVariableStatistic)
        assert stat_a.m_squared_d_sum is not None
        assert stat_b.m_squared_d_sum is not None
        self.assertEqual(
            summed.m_squared_d_sum, stat_a.m_squared_d_sum + stat_b.m_squared_d_sum
        )


class TestEffectMomentsIVRelative(TestCase):
    def test_matches_fixtures(self):
        for case in STRONG_CASES:
            with self.subTest(case=case["name"]):
                _, stats = stats_for(case["name"])
                moments = EffectMomentsIV(stats, RELATIVE)
                result = moments.compute_result()
                expected = case["expected_relative"]
                self.assertIsNone(result.error_message)
                np.testing.assert_allclose(
                    result.point_estimate, expected["point_estimate"], rtol=1e-9
                )
                np.testing.assert_allclose(
                    result.standard_error, expected["standard_error"], rtol=1e-9
                )
                np.testing.assert_allclose(
                    moments.complier_control_mean,
                    expected["complier_control_mean"],
                    rtol=1e-9,
                )

    def test_agrees_with_bootstrap(self):
        for case in STRONG_CASES:
            with self.subTest(case=case["name"]):
                _, stats = stats_for(case["name"])
                result = EffectMomentsIV(stats, RELATIVE).compute_result()
                np.testing.assert_allclose(
                    result.standard_error,
                    case["reference_bootstrap_relative_standard_error"],
                    rtol=0.05,
                )

    def test_is_absolute_effect_over_complier_control_mean(self):
        for case in STRONG_CASES:
            with self.subTest(case=case["name"]):
                _, stats = stats_for(case["name"])
                relative = EffectMomentsIV(stats, RELATIVE)
                absolute = EffectMomentsIV(stats, ABSOLUTE)
                np.testing.assert_allclose(
                    relative.point_estimate,
                    absolute.point_estimate / abs(relative.complier_control_mean),
                )

    def test_one_sided_baseline_is_not_the_control_arm_mean(self):
        # never-takers sit in the control arm too, so its mean is the wrong baseline
        _, stat_a, stat_b = arms_for("one_sided_noncompliance")
        moments = EffectMomentsIV([(stat_a, stat_b)], RELATIVE)
        control_arm_mean = stat_a.m_statistic.mean
        self.assertGreater(moments.complier_control_mean, control_arm_mean + 0.5)

    def test_count_outcome_needs_adopter_sum_squares(self):
        _, stripped = without_adopter_sum_squares("one_sided_noncompliance")
        result = EffectMomentsIV(stripped, RELATIVE).compute_result()
        self.assertEqual(result.error_message, IV_RELATIVE_MISSING_STATISTIC_MESSAGE)
        self.assertIsNone(
            EffectMomentsIV(stripped, ABSOLUTE).compute_result().error_message
        )

    def test_binary_outcome_does_not_need_adopter_sum_squares(self):
        case, stripped = without_adopter_sum_squares("binary_outcome")
        result = EffectMomentsIV(stripped, RELATIVE).compute_result()
        self.assertIsNone(result.error_message)
        np.testing.assert_allclose(
            result.standard_error, case["expected_relative"]["standard_error"]
        )

    def test_weak_instrument_is_flagged_not_suppressed(self):
        case, stats = stats_for("weak_instrument")
        result = EffectMomentsIV(stats, RELATIVE).compute_result()
        self.assertIsNone(result.error_message)
        self.assertTrue(result.weak_instrument)
        np.testing.assert_allclose(
            result.point_estimate, case["expected_relative"]["point_estimate"]
        )


class TestIVThroughEngines(TestCase):
    def setUp(self):
        self.case, self.stats = stats_for("two_sided_unequal_arms")
        self.expected = self.case["expected"]

    def test_differs_from_ratio_metric(self):
        def as_ratio(s: InstrumentalVariableStatistic) -> RatioStatistic:
            return RatioStatistic(
                n=s.n,
                m_statistic=s.m_statistic,
                d_statistic=s.d_statistic,
                m_d_sum_of_products=s.m_d_sum_of_products,
            )

        _, stat_a, stat_b = arms_for("two_sided_unequal_arms")
        ratio_stats: Pairs = [(as_ratio(stat_a), as_ratio(stat_b))]
        config = FrequentistConfig(difference_type="absolute")
        iv = TwoSidedTTest(self.stats, config).compute_result()
        ratio = TwoSidedTTest(ratio_stats, config).compute_result()
        assert iv.expected is not None and ratio.expected is not None
        self.assertGreater(iv.expected, 0)
        self.assertLess(ratio.expected, 0)

    def test_frequentist(self):
        result = TwoSidedTTest(
            self.stats, FrequentistConfig(difference_type="absolute")
        ).compute_result()
        self.assertIsNone(result.errorMessage)
        np.testing.assert_allclose(result.expected, self.expected["point_estimate"])
        self.assertLess(result.ci[0], self.case["true_cace"])
        self.assertGreater(result.ci[1], self.case["true_cace"])

    def test_sequential_is_wider(self):
        fixed = TwoSidedTTest(
            self.stats, FrequentistConfig(difference_type="absolute")
        ).compute_result()
        sequential = SequentialTwoSidedTTest(
            self.stats, SequentialConfig(difference_type="absolute")
        ).compute_result()
        self.assertIsNone(sequential.errorMessage)
        fixed_lower, fixed_upper = fixed.ci
        sequential_lower, sequential_upper = sequential.ci
        assert fixed_lower is not None and fixed_upper is not None
        assert sequential_lower is not None and sequential_upper is not None
        self.assertLess(sequential_lower, fixed_lower)
        self.assertGreater(sequential_upper, fixed_upper)

    def test_bayesian(self):
        result = EffectBayesianABTest(
            self.stats, EffectBayesianConfig(difference_type="absolute")
        ).compute_result()
        self.assertIsNone(result.errorMessage)
        np.testing.assert_allclose(result.expected, self.expected["point_estimate"])
        self.assertGreater(result.chanceToWin, 0.99)

    def test_relative_intervals_cover_the_true_lift(self):
        for case in STRONG_CASES:
            _, stats = stats_for(case["name"])
            tests = {
                "frequentist": TwoSidedTTest(
                    stats, FrequentistConfig(difference_type="relative")
                ),
                "sequential": SequentialTwoSidedTTest(
                    stats, SequentialConfig(difference_type="relative")
                ),
                "bayesian": EffectBayesianABTest(
                    stats, EffectBayesianConfig(difference_type="relative")
                ),
            }
            for engine, test in tests.items():
                with self.subTest(case=case["name"], engine=engine):
                    result = test.compute_result()
                    self.assertIsNone(result.errorMessage)
                    self.assertLess(result.ci[0], case["true_relative_lift"])
                    self.assertGreater(result.ci[1], case["true_relative_lift"])

    def test_weak_instrument_reaches_realized_settings(self):
        case, stats = stats_for("weak_instrument")
        tests = [
            TwoSidedTTest(stats, FrequentistConfig(difference_type="absolute")),
            SequentialTwoSidedTTest(
                stats, SequentialConfig(difference_type="absolute")
            ),
            EffectBayesianABTest(
                stats, EffectBayesianConfig(difference_type="absolute")
            ),
        ]
        for test in tests:
            with self.subTest(test=type(test).__name__):
                result = test.compute_result()
                self.assertIsNone(result.errorMessage)
                np.testing.assert_allclose(
                    result.expected, case["expected"]["point_estimate"]
                )
                self.assertTrue(test.realized_settings.weakInstrument)
                np.testing.assert_allclose(
                    test.realized_settings.firstStageF,
                    case["expected"]["first_stage_f"],
                )

    def test_other_metrics_are_never_flagged(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3407)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        test = TwoSidedTTest([(stat_a, stat_b)], FrequentistConfig())
        self.assertFalse(test.realized_settings.weakInstrument)
        self.assertIsNone(test.realized_settings.firstStageF)


class TestIVFromQueryRows(TestCase):
    def analyze(
        self,
        case_name: str,
        difference_type: DifferenceType = "absolute",
        with_adopter_sum_squares: bool = True,
    ) -> Tuple[dict, FrequentistVariationResponseIndividual]:
        case = next(c for c in FIXTURES if c["name"] == case_name)
        rows = pd.DataFrame(
            [
                {
                    "dimension": "All",
                    "variation": variation,
                    "users": case[f"stat_{arm}"]["n"],
                    "count": case[f"stat_{arm}"]["n"],
                    "main_sum": case[f"stat_{arm}"]["y_sum"],
                    "main_sum_squares": case[f"stat_{arm}"]["y_sum_squares"],
                    "denominator_sum": case[f"stat_{arm}"]["d_sum"],
                    "denominator_sum_squares": case[f"stat_{arm}"]["d_sum"],
                    "main_denominator_sum_product": case[f"stat_{arm}"][
                        "y_d_sum_product"
                    ],
                    **(
                        {
                            "main_squared_denominator_sum_product": case[f"stat_{arm}"][
                                "y_squared_d_sum_product"
                            ]
                        }
                        if with_adopter_sum_squares
                        else {}
                    ),
                }
                for arm, variation in (("a", "zero"), ("b", "one"))
            ]
        )
        metric = MetricSettingsForStatsEngine(
            id="",
            name="",
            statistic_type="iv",
            main_metric_type=case["outcome_type"],
            denominator_metric_type="binomial",
        )
        analysis = AnalysisSettingsForStatsEngine(
            var_names=["zero", "one"],
            var_ids=["0", "1"],
            weights=[0.5, 0.5],
            stats_engine="frequentist",
            difference_type=difference_type,
        )
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df, num_variations=2, metric=metric, analysis=analysis
        )
        variation = result[0].variations[1]
        assert isinstance(variation, FrequentistVariationResponseIndividual)
        return case, variation

    def test_estimate_from_rows(self):
        for name in ("one_sided_noncompliance", "binary_outcome"):
            with self.subTest(case=name):
                case, variation = self.analyze(name)
                self.assertIsNone(variation.errorMessage)
                np.testing.assert_allclose(
                    variation.expected, case["expected"]["point_estimate"]
                )
                np.testing.assert_allclose(
                    variation.uplift.stddev, case["expected"]["standard_error"]
                )

    def test_weak_instrument_warning_from_rows(self):
        case, variation = self.analyze("weak_instrument")
        self.assertIsNone(variation.errorMessage)
        np.testing.assert_allclose(
            variation.expected, case["expected"]["point_estimate"]
        )
        self.assertTrue(variation.realizedSettings.weakInstrument)
        assert variation.realizedSettings.firstStageF is not None
        np.testing.assert_allclose(
            variation.realizedSettings.firstStageF,
            case["expected"]["first_stage_f"],
        )
        _, strong = self.analyze("one_sided_noncompliance")
        self.assertFalse(strong.realizedSettings.weakInstrument)

    def test_relative_estimate_from_rows(self):
        for name in ("one_sided_noncompliance", "binary_outcome"):
            with self.subTest(case=name):
                case, variation = self.analyze(name, "relative")
                self.assertIsNone(variation.errorMessage)
                np.testing.assert_allclose(
                    variation.expected, case["expected_relative"]["point_estimate"]
                )
                np.testing.assert_allclose(
                    variation.uplift.stddev,
                    case["expected_relative"]["standard_error"],
                )

    def test_relative_without_the_new_column(self):
        _, variation = self.analyze(
            "one_sided_noncompliance", "relative", with_adopter_sum_squares=False
        )
        self.assertEqual(variation.errorMessage, IV_RELATIVE_MISSING_STATISTIC_MESSAGE)
        case, variation = self.analyze(
            "binary_outcome", "relative", with_adopter_sum_squares=False
        )
        self.assertIsNone(variation.errorMessage)
        np.testing.assert_allclose(
            variation.expected, case["expected_relative"]["point_estimate"]
        )


if __name__ == "__main__":
    unittest_main()
