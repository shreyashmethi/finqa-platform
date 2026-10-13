// Upload a new document set (admins) in three steps: company (or add a new one), fiscal year,
// files (drag and drop). Files are checked here for type, size and duplicates so mistakes show up
// before the upload; the server validates again (type, size, real PDF/XLSX). By default a review
// starts as soon as the upload finishes and the user lands on its live trace.
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Icon } from "../components/Icons";
import { NewCompany } from "../components/CompanyForm";
import { ErrorNote, Loading } from "../components/Marks";
import { useToast } from "../components/Toast";
import { DOC_NAMES } from "../components/TickTieStrip";
import { usePageTitle } from "../prefs";
import { useAsync, useStoredFlag } from "../hooks";

const ALLOWED = [".pdf", ".xlsx", ".csv"];
const MAX_MB = 100;

function ext(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function problem(f: File, all: File[]): string | null {
  if (!ALLOWED.includes(ext(f.name))) return "Only PDF, XLSX and CSV files can be reviewed";
  if (f.size === 0) return "The file is empty";
  if (f.size > MAX_MB * 1024 * 1024) return `Larger than ${MAX_MB} MB`;
  if (all.filter((x) => x.name === f.name).length > 1) return "Same file name twice";
  return null;
}

export function Upload() {
  usePageTitle("Upload documents");
  const navigate = useNavigate();
  const toast = useToast();
  const companies = useAsync(() => api.companies(), []);
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState(false);
  const [autoRun, setAutoRun] = useStoredFlag("finqa.uploadAutoRun", true);
  const input = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    // Re-adding a file with the same name replaces it.
    setFiles((cur) => [...cur.filter((f) => !incoming.some((n) => n.name === f.name)), ...incoming]);
    setError(null);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  }

  const company = companies.data?.find((c) => c.id === companyId);
  const problems = files.map((f) => problem(f, files));
  const valid = files.length > 0 && problems.every((p) => !p);
  const yearNum = Number(year);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 1990 && yearNum <= 2100;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!companyId) return setError("Choose the company these documents belong to.");
    if (!yearOk) return setError("Enter the fiscal year as four digits, e.g. 2025.");
    if (files.length === 0) return setError("Add at least one file.");
    if (!valid) return setError("Remove or replace the files marked in red first.");
    const form = new FormData();
    form.set("company_id", companyId);
    form.set("fiscal_year", year);
    files.forEach((f) => form.append("files", f));
    setBusy(true);
    try {
      const set = await api.uploadSet(form);
      if (autoRun) {
        const run = await api.startRun(set.id);
        toast(`Uploaded ${set.id}. Review started.`);
        navigate(`/runs/${run.id}`);
      } else {
        toast(`Uploaded ${set.id}.`);
        navigate(`/sets/${set.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (companies.error) return <ErrorNote message={companies.error} onRetry={companies.reload} />;
  if (!companies.data) return <Loading />;
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Admin</p>
        <h1>Upload documents</h1>
        <p className="lede">Add one company's documents for one fiscal year: typically the annual report, board deck, press release, management accounts and KPI file.</p>
      </header>

      <form className="upload-form" onSubmit={submit}>
        <fieldset className="step-card">
          <legend>
            <span className="step-num">1</span> Company
          </legend>
          <div className="inline-field">
            <select id="company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company">
              <option value="">Choose a company…</option>
              {companies.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id}, {c.currency})
                </option>
              ))}
            </select>
            <button type="button" className="quiet-button" onClick={() => setNewCompany(true)}>
              <Icon name="plus" size={16} /> New company
            </button>
          </div>
          {company && (
            <p className="field-help">
              {[company.sector, `reports in ${company.currency}`, company.fiscal_year_end && `year ends ${company.fiscal_year_end}`].filter(Boolean).join(" · ")}
            </p>
          )}
        </fieldset>

        <fieldset className="step-card">
          <legend>
            <span className="step-num">2</span> Fiscal year
          </legend>
          <input id="fy" type="number" min={1990} max={2100} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Fiscal year" aria-invalid={!yearOk} className="year-input" />
          <p className="field-help">The calendar year in which the fiscal year ends{company?.fiscal_year_end ? ` (${company.fiscal_year_end})` : ""}.</p>
        </fieldset>

        <fieldset className="step-card">
          <legend>
            <span className="step-num">3</span> Files
          </legend>
          <div
            className={`dropzone${drag ? " is-dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
          >
            <Icon name="upload" size={28} />
            <strong>Drop files here or click to choose</strong>
            <small>PDF, XLSX or CSV, up to {MAX_MB} MB each</small>
            <input
              ref={input}
              id="files"
              type="file"
              multiple
              accept=".pdf,.xlsx,.csv"
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = ""; // allow choosing the same file again after removing it
              }}
            />
          </div>
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={f.name} className={problems[i] ? "has-problem" : ""}>
                  <Icon name={ext(f.name) === ".pdf" ? "file" : "table"} />
                  <span className="file-text">
                    <strong>{DOC_NAMES[f.name] ?? f.name}</strong>
                    <small>
                      {DOC_NAMES[f.name] ? `${f.name} · ` : ""}
                      {f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                      {problems[i] && <span className="problem"> · {problems[i]}</span>}
                    </small>
                  </span>
                  <button type="button" className="icon-button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                    <Icon name="x" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <ErrorNote message={error} />
        <div className="form-foot">
          <label className="check">
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
            Start a review as soon as the upload finishes
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Uploading…" : autoRun ? "Upload and review" : "Upload"}
          </button>
          <Link to="/sets" className="quiet-button button">
            Cancel
          </Link>
        </div>
      </form>

      <NewCompany
        open={newCompany}
        onClose={() => setNewCompany(false)}
        existing={companies.data}
        onCreated={(c) => {
          companies.setData([...(companies.data ?? []), c].sort((a, b) => a.id.localeCompare(b.id)));
          setCompanyId(c.id);
          setNewCompany(false);
          toast(`Added ${c.name}.`);
        }}
      />
    </>
  );
}
