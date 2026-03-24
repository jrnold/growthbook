from unittest import TestCase

import numpy as np

from gbstats.models.settings import AnalysisSettingsForStatsEngine
from gbstats.ssrm import compute_srm_p_value, sequential_p_values

_BASE = AnalysisSettingsForStatsEngine(
    var_names=["control", "treatment"],
    var_ids=["v0", "v1"],
    weights=[0.5, 0.5],
)


def _make_analysis(
    srm_method: str = "chi_squared",
    srm_daily_users: list[list[int]] | None = None,
) -> AnalysisSettingsForStatsEngine:
    """Return a copy of _BASE with SRM fields overridden."""
    import dataclasses

    overrides: dict = {"srm_method": srm_method}
    if srm_daily_users is not None:
        overrides["srm_daily_users"] = srm_daily_users
    return dataclasses.replace(_BASE, **overrides)


class TestSequentialPValues(TestCase):
    def test_balanced_returns_high_p(self) -> None:
        p = sequential_p_values(np.array([[500, 500]]), np.array([0.5, 0.5]))
        self.assertGreater(p[-1], 0.05)

    def test_imbalanced_returns_low_p(self) -> None:
        p = sequential_p_values(np.array([[100, 900]]), np.array([0.5, 0.5]))
        self.assertLess(p[-1], 0.05)

    def test_empty_returns_empty(self) -> None:
        self.assertEqual(
            sequential_p_values(np.array([]).reshape(0, 2), np.array([0.5, 0.5])),
            [],
        )


class TestComputeSrmPValue(TestCase):
    """Tests for the top-level compute_srm_p_value dispatcher."""

    def test_sequential_returns_valid_p_value(self) -> None:
        analysis = _make_analysis(srm_method="sequential", srm_daily_users=[[500, 600]])
        p = compute_srm_p_value(analysis, None, 2)
        self.assertGreaterEqual(p, 0.0)
        self.assertLessEqual(p, 1.0)

    def test_sequential_balanced_high_p_value(self) -> None:
        analysis = _make_analysis(srm_method="sequential", srm_daily_users=[[500, 500]])
        p = compute_srm_p_value(analysis, None, 2)
        self.assertGreater(p, 0.05)

    def test_sequential_imbalanced_low_p_value(self) -> None:
        analysis = _make_analysis(srm_method="sequential", srm_daily_users=[[100, 900]])
        p = compute_srm_p_value(analysis, None, 2)
        self.assertLess(p, 0.05)

    def test_sequential_zero_users_returns_one(self) -> None:
        analysis = _make_analysis(srm_method="sequential", srm_daily_users=[[0, 0]])
        p = compute_srm_p_value(analysis, None, 2)
        self.assertEqual(p, 1.0)

    def test_chi_squared_default(self) -> None:
        analysis_default = _make_analysis(srm_daily_users=[[500, 600]])
        analysis_explicit = _make_analysis(
            srm_method="chi_squared", srm_daily_users=[[500, 600]]
        )
        p_default = compute_srm_p_value(analysis_default, None, 2)
        p_explicit = compute_srm_p_value(analysis_explicit, None, 2)
        self.assertAlmostEqual(p_default, p_explicit)

    def test_multiday_sequential_balanced_high_p_value(self) -> None:
        analysis = _make_analysis(
            srm_method="sequential",
            srm_daily_users=[[250, 250], [250, 250]],
        )
        p = compute_srm_p_value(analysis, None, 2)
        self.assertGreater(p, 0.05)

    def test_multiday_sequential_imbalanced_low_p_value(self) -> None:
        analysis = _make_analysis(
            srm_method="sequential",
            srm_daily_users=[[50, 450], [50, 450]],
        )
        p = compute_srm_p_value(analysis, None, 2)
        self.assertLess(p, 0.05)

    def test_chi_squared_2d_matches_aggregated_1d(self) -> None:
        analysis_2d = _make_analysis(srm_daily_users=[[250, 300], [250, 300]])
        analysis_1d = _make_analysis(srm_daily_users=[[500, 600]])
        p_2d = compute_srm_p_value(analysis_2d, None, 2)
        p_1d = compute_srm_p_value(analysis_1d, None, 2)
        self.assertAlmostEqual(p_2d, p_1d, places=10)
