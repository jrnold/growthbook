// Self-contained SRM method selector for AnalysisForm.
// Extracted to reduce rebase friction in the upstream AnalysisForm component.

import React, { FC, useCallback, useState } from "react";
import { useFormContext } from "react-hook-form";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";

/**
 * SrmMethodSelector manages the SRM method selection, tuning parameters,
 * and the "Reset to Organization Default" checkbox. It reads/writes
 * `srmMethod`, `srmSlabWeight`, `srmDirichletConcentration` via
 * useFormContext() (same pattern as StatsEngineSettings).
 *
 * On mount, if the experiment had no srmMethod override, usingOrgSrmMethod
 * starts as true and the fields are disabled.
 *
 * The parent form reads `_srmUseOrgDefault` at submit time to decide
 * whether to clear the experiment-level SRM settings.
 */
const SrmMethodSelector: FC<{
  experimentSrmMethodDefined: boolean;
}> = ({ experimentSrmMethodDefined }) => {
  const form = useFormContext();
  const orgSettings = useOrgSettings();

  const [usingOrgSrmMethod, setUsingOrgSrmMethod] = useState(
    !experimentSrmMethodDefined,
  );

  const setSrmMethodToDefault = useCallback(
    (enable: boolean) => {
      if (enable) {
        form.setValue("srmMethod", orgSettings.srmMethod ?? "chi_squared");
        form.setValue("srmSlabWeight", orgSettings.srmSlabWeight ?? 0.0);
        form.setValue(
          "srmDirichletConcentration",
          orgSettings.srmDirichletConcentration ?? 10000,
        );
      }
      setUsingOrgSrmMethod(enable);
    },
    [
      form,
      orgSettings.srmMethod,
      orgSettings.srmSlabWeight,
      orgSettings.srmDirichletConcentration,
    ],
  );

  // Write a hidden flag so the submit handler knows whether to clear srmMethod
  React.useEffect(() => {
    form.setValue("_srmUseOrgDefault", usingOrgSrmMethod);
  }, [form, usingOrgSrmMethod]);

  const srmMethod = form.watch("srmMethod") ?? "chi_squared";

  return (
    <>
      {/* TODO: migrate Bootstrap layout classes to Radix (matches existing pattern in this file) */}
      <div className="d-flex flex-row no-gutters align-items-top">
        <div className="col-5">
          <SelectField
            label="SRM Test Method"
            labelClassName="font-weight-bold"
            value={srmMethod}
            onChange={(v) => {
              form.setValue("srmMethod", v as "chi_squared" | "sequential");
            }}
            options={[
              { label: "Chi-squared", value: "chi_squared" },
              { label: "Sequential", value: "sequential" },
            ]}
            helpText="Chi-squared is the default. Sequential (SSRM) is better suited for experiments monitored continuously."
            disabled={usingOrgSrmMethod}
          />
        </div>
        <div className="col align-self-center">
          <label className="ml-5">
            <input
              type="checkbox"
              className="form-check-input"
              checked={usingOrgSrmMethod}
              onChange={(e) => setSrmMethodToDefault(e.target.checked)}
            />
            Reset to Organization Default
          </label>
        </div>
      </div>
      {srmMethod === "sequential" && (
        <div className="d-flex flex-row no-gutters" style={{ gap: "16px" }}>
          <div className="col-3">
            <Field
              label="Slab Weight"
              helpText="Mixture weight for the diffuse prior. 0 = spike only."
              type="number"
              step="0.01"
              min={0}
              max={1}
              disabled={usingOrgSrmMethod}
              {...form.register("srmSlabWeight", {
                valueAsNumber: true,
                min: 0,
                max: 1,
              })}
            />
          </div>
          <div className="col-3">
            <Field
              label="Spike Concentration"
              helpText="Dirichlet concentration for the informative prior."
              type="number"
              step={100}
              min={1}
              disabled={usingOrgSrmMethod}
              {...form.register("srmDirichletConcentration", {
                valueAsNumber: true,
                min: 1,
              })}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default SrmMethodSelector;
