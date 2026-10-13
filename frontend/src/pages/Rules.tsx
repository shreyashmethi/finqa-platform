// Review rules (admins): which figures the baseline agent watches and how large a year-on-year
// change must be before it is flagged. A worked example shows what the threshold means; changes
// apply to reviews started afterwards, and unsaved edits are marked until saved or reset.
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNote, Loading } from "../components/Marks";
import { useToast } from "../components/Toast";
import { ALL_METRICS, metricName } from "../format";
import { usePageTitle } from "../prefs";
import { useAsync } from "../hooks";

export function Rules() {
  usePageTitle("Review rules");
  const toast = useToast();
  const { data, error, reload, setData } = useAsync(() => api.rules(), []);
  const [threshold, setThreshold] = useState(30);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reset() {
    if (!data) return;
    setThreshold(Math.round(data.anomaly_threshold * 100));
    setMetrics(data.baseline_metrics);
    setSaveError(null);
  }
  useEffect(reset, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    !!data &&
    (Math.round(data.anomaly_threshold * 100) !== threshold || [...data.baseline_metrics].sort().join() !== [...metrics].sort().join());
  const validThreshold = Number.isFinite(threshold) && threshold >= 1 && threshold <= 500;

  async function save() {
    setSaveError(null);
    if (!validThreshold) return setSaveError("Choose a threshold between 1 and 500 percent.");
    setBusy(true);
    try {
      setData(await api.saveRules({ anomaly_threshold: threshold / 100, baseline_metrics: metrics }));
      toast("Rules saved. They apply to reviews started from now on.");
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const example = 100 * (1 + threshold / 100);
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Admin</p>
        <h1>Review rules</h1>
        <p className="lede">
          The baseline agent compares this year's figures with last year's audited figures and flags unusually large changes. These rules apply to reviews started
          after you save; earlier reviews keep the rules they ran with.
        </p>
      </header>

      <div className="rules-layout">
        <section className="step-card">
          <h2>Flag a year-on-year change larger than</h2>
          <div className="threshold">
            <input type="range" min={5} max={200} step={5} value={Math.min(200, Math.max(5, threshold))} onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Threshold (slider)" />
            <span className="inline-field">
              <input id="threshold" type="number" min={1} max={500} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} aria-invalid={!validThreshold} />
              <span>%</span>
            </span>
          </div>
          <p className="example">
            Example: revenue of 100m last year is flagged this year if it is above <strong>{example.toLocaleString("en-US", { maximumFractionDigits: 1 })}m</strong> or
            below <strong>{Math.max(0, 100 - threshold).toLocaleString("en-US", { maximumFractionDigits: 1 })}m</strong>. A lower threshold flags more changes.
          </p>
        </section>

        <section className="step-card">
          <div className="section-head">
            <h2>Figures to compare with last year</h2>
            <span className="actions">
              <button className="link-button" onClick={() => setMetrics(ALL_METRICS)}>
                Select all
              </button>
              <button className="link-button" onClick={() => setMetrics([])}>
                None
              </button>
            </span>
          </div>
          <div className="metric-grid">
            {ALL_METRICS.map((m) => (
              <label key={m} className={`check metric-check${metrics.includes(m) ? " is-on" : ""}`}>
                <input type="checkbox" checked={metrics.includes(m)} onChange={(e) => setMetrics(e.target.checked ? [...metrics, m] : metrics.filter((x) => x !== m))} />
                {metricName(m)}
              </label>
            ))}
          </div>
          {metrics.length === 0 && <p className="quiet">With no figures selected, reviews skip the year-on-year check.</p>}
        </section>
      </div>

      <ErrorNote message={saveError} />
      <div className={`save-bar${dirty ? " is-dirty" : ""}`}>
        <span>{dirty ? "You have unsaved changes." : "All changes saved."}</span>
        <button className="quiet-button" onClick={reset} disabled={!dirty || busy}>
          Reset
        </button>
        <button className="primary" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save rules"}
        </button>
      </div>
    </>
  );
}
