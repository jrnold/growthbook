"""Simulate experiments with noncompliance; emit sufficient statistics and
reference Wald / 2SLS results computed from unit-level data."""

import json
import sys
import numpy as np


def simulate(seed, n_a, n_b, p_a, p_b, cace, name, note, binary=False):
    rng = np.random.default_rng(seed)
    out = {}
    unit = {}
    for arm, n, p in (("a", n_a, p_a), ("b", n_b, p_b)):
        # latent type drives both take-up and baseline outcome -> selection
        u = rng.uniform(size=n)
        d = (u < p).astype(float)
        y = 10 + 4 * (1 - u) + rng.normal(0, 3, n) + cace * d
        if binary:
            y = (rng.uniform(size=n) < 0.1 + 0.2 * (1 - u) + cace * d).astype(float)
        unit[arm] = (y, d)
        out[f"stat_{arm}"] = dict(
            n=n,
            y_sum=float(y.sum()),
            y_sum_squares=float((y**2).sum()),
            d_sum=float(d.sum()),
            y_d_sum_product=float((y * d).sum()),
            y_squared_d_sum_product=float((y**2 * d).sum()),
        )
    (ya, da), (yb, db) = unit["a"], unit["b"]
    dy, dd = yb.mean() - ya.mean(), db.mean() - da.mean()
    # take-up variance as gbstats ProportionStatistic computes it: p(1-p)
    vd = da.mean() * (1 - da.mean()) / n_a + db.mean() * (1 - db.mean()) / n_b
    vy = ya.var(ddof=1) / n_a + yb.var(ddof=1) / n_b
    if binary:
        vy = ya.mean() * (1 - ya.mean()) / n_a + yb.mean() * (1 - yb.mean()) / n_b

    # covariance as gbstats compute_covariance does: n for two proportions, else n-1
    def cov(y, d):
        if binary:
            return (y * d).mean() - y.mean() * d.mean()
        return ((y * d).sum() - y.sum() * d.sum() / len(y)) / (len(y) - 1)

    c = cov(ya, da) / n_a + cov(yb, db) / n_b
    tau = dy / dd
    var = (vy - 2 * tau * c + tau**2 * vd) / dd**2
    # independent check: 2SLS with HC0 sandwich
    z = np.r_[np.zeros(n_a), np.ones(n_b)]
    y = np.r_[ya, yb]
    d = np.r_[da, db]
    Z = np.c_[np.ones_like(z), z]
    X = np.c_[np.ones_like(d), d]
    beta = np.linalg.solve(Z.T @ X, Z.T @ y)
    e = y - X @ beta
    A = np.linalg.inv(Z.T @ X)
    meat = (Z * e[:, None] ** 2).T @ Z
    se_2sls = float(np.sqrt((A @ meat @ A.T)[1, 1]))
    assert abs(beta[1] - tau) < 1e-8
    # relative effect against the complier control mean
    ddof = 0 if binary else 1

    def lift(ya, da, yb, db):
        dv = (yb * db).mean() - (ya * da).mean()
        dw = (yb * (1 - db)).mean() - (ya * (1 - da)).mean()
        mu_c0 = -dw / (db.mean() - da.mean())
        return (-dv / dw - 1) * np.sign(mu_c0), mu_c0, dv, dw

    rel_estimate, mu_c0, dv, dw = lift(ya, da, yb, db)
    va, wa, vb, wb = ya * da, ya * (1 - da), yb * db, yb * (1 - db)
    var_dv = va.var(ddof=ddof) / n_a + vb.var(ddof=ddof) / n_b
    var_dw = wa.var(ddof=ddof) / n_a + wb.var(ddof=ddof) / n_b
    cov_vw = (
        np.cov(va, wa, ddof=ddof)[0, 1] / n_a + np.cov(vb, wb, ddof=ddof)[0, 1] / n_b
    )
    rel_var = var_dv / dw**2 + var_dw * dv**2 / dw**4 - 2 * cov_vw * dv / dw**3
    boot_rng = np.random.default_rng(1000 + seed)
    boot = []
    for _ in range(0 if name == "weak_instrument" else 1000):
        ia, ib = boot_rng.integers(0, n_a, n_a), boot_rng.integers(0, n_b, n_b)
        boot.append(lift(ya[ia], da[ia], yb[ib], db[ib])[0])
    mid = (p_a + p_b) / 2
    true_mu_c0 = 0.1 + 0.2 * (1 - mid) if binary else 10 + 4 * (1 - mid)
    out["true_relative_lift"] = cace / true_mu_c0
    out["expected_relative"] = dict(
        point_estimate=float(rel_estimate),
        standard_error=float(np.sqrt(rel_var)),
        complier_control_mean=float(mu_c0),
    )
    out["reference_bootstrap_relative_standard_error"] = (
        float(np.std(boot, ddof=1)) if boot else None
    )
    out["outcome_type"] = "binomial" if binary else "count"
    out.update(
        name=name,
        note=note,
        true_cace=cace,
        expected=dict(
            point_estimate=float(tau),
            standard_error=float(np.sqrt(var)),
            first_stage_f=float(dd**2 / vd),
        ),
        reference_2sls_hc0_standard_error=se_2sls,
    )
    return out


cases = [
    simulate(
        1,
        5000,
        5000,
        0.0,
        0.4,
        2.0,
        "one_sided_noncompliance",
        "Control cannot take up; strong instrument",
    ),
    simulate(
        2,
        4000,
        6000,
        0.2,
        0.5,
        1.5,
        "two_sided_unequal_arms",
        "Some control take-up; unequal arm sizes",
    ),
    simulate(
        3,
        8000,
        8000,
        0.3,
        0.9,
        -1.0,
        "negative_effect_high_takeup",
        "Treatment hurts compliers",
    ),
    simulate(
        5,
        20000,
        20000,
        0.0,
        0.25,
        0.08,
        "binary_outcome",
        "Conversion outcome; both statistics are proportions",
        binary=True,
    ),
    simulate(
        4,
        3000,
        3000,
        0.30,
        0.31,
        2.0,
        "weak_instrument",
        "Assignment barely moves take-up; expect WEAK_INSTRUMENT",
    ),
]
for c in cases:
    e = c["expected"]
    print(
        c["name"], e, "2sls se", c["reference_2sls_hc0_standard_error"], file=sys.stderr
    )
json.dump(
    {
        "description": "Language-neutral IV (Wald) test vectors. Inputs are per-arm sufficient statistics as emitted by the ratio-metric SQL; stat_a is control. Take-up variance is p(1-p); for a count outcome, variance and covariance use n-1; for a binomial outcome, variance is p(1-p) and covariance uses n (y_sum_squares equals y_sum). expected_relative is the complier effect divided by the absolute complier control mean; it needs y_squared_d_sum_product unless the outcome is binomial.",
        "cases": cases,
    },
    sys.stdout,
    indent=2,
)
