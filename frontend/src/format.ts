// Formatting helpers: metric names, periods, money, dates. Kept in one place so every screen
// speaks the same vocabulary.

const METRIC_NAMES: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of goods sold",
  gross_profit: "Gross profit",
  opex: "Operating expenses",
  ebitda: "EBITDA",
  d_and_a: "Depreciation & amortisation",
  ebit: "EBIT",
  interest_expense: "Finance costs",
  pbt: "Profit before tax",
  tax: "Tax",
  net_income: "Net income",
  total_assets: "Total assets",
  total_liabilities: "Total liabilities",
  total_equity: "Total equity",
  cash: "Cash",
  employee_costs: "Employee costs",
  headcount: "Headcount",
  capex: "Capex",
};

export const ALL_METRICS = Object.keys(METRIC_NAMES);

export function metricName(metric: string): string {
  if (metric.startsWith("segment_revenue:")) return `${metric.slice(16)} segment revenue`;
  return METRIC_NAMES[metric] ?? metric;
}

/** "FY2025-Q3" -> "Q3 FY2025" */
export function periodName(period: string): string {
  const [fy, q] = period.split("-");
  return q ? `${q} ${fy}` : fy;
}

export const TYPE_NAMES: Record<string, string> = {
  value_mismatch: "Value mismatch",
  unit_error: "Unit error",
  transposition: "Transposed digits",
  stale_period: "Stale figure",
  sign_error: "Sign flipped",
  missing_item: "Missing figure",
  baseline_anomaly: "Unusual change",
};

export const STATUS_NAMES: Record<string, string> = {
  open: "Open",
  accepted: "Confirmed",
  rejected: "False positive",
  overridden: "Corrected",
  resolved_by_rerun: "No longer found",
};

/** Money in a compact, unambiguous form: 8,659.70m USD; persons as plain counts. */
export function amount(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "blank";
  if (unit === "persons") return `${Math.round(value).toLocaleString("en-US")} people`;
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 })}bn ${unit}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}m ${unit}`;
  return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${unit}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Where a figure sits, in words: "Page 32, Consolidated balance sheet" / "P&L sheet, cell F15". */
export function whereText(loc: { page?: number; table?: string; sheet?: string; cell?: string; line?: number }) {
  if (loc.page) return `Page ${loc.page}${loc.table ? `, ${loc.table}` : ""}`;
  if (loc.sheet) return `${loc.sheet} sheet, cell ${loc.cell}`;
  if (loc.line) return `Line ${loc.line}`;
  return "";
}

/** Show plain numeric strings with thousands separators, as a spreadsheet would; leave text alone. */
export function grouped(v: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(v)) return v;
  const decimals = v.includes(".") ? v.split(".")[1].length : 0;
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "1 page" / "23 pages" */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  if (secs < 7 * 86400) return `${Math.round(secs / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Signed relative difference of ``reported`` against ``expected``: "+8.1%", "−100%". */
export function pctDiff(expected: number | null, reported: number | null): string | null {
  if (expected === null || reported === null || expected === 0) return null;
  const p = ((reported - expected) / Math.abs(expected)) * 100;
  const abs = Math.abs(p);
  const text = abs >= 100 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(abs < 10 ? 1 : 0);
  return `${p < 0 ? "−" : "+"}${text}%`;
}

/** Agent names as people read them, keyed by graph node. */
export const NODE_NAMES: Record<string, string> = {
  supervisor: "Supervisor",
  extraction: "Extraction agent",
  reconciliation: "Reconciliation agent",
  baseline: "Baseline agent",
  exceptions: "Exception agent",
  finish: "Summary",
};

/** One-sentence explanation of each discrepancy kind, for tooltips and filters. */
export const TYPE_HINTS: Record<string, string> = {
  value_mismatch: "One document reports a different amount from the others.",
  unit_error: "The figure looks entered in the wrong unit (thousands vs millions, lakh vs crore).",
  transposition: "Two adjacent digits look swapped.",
  stale_period: "The figure matches last year's value, not this year's.",
  sign_error: "The figure has the opposite sign to the other documents.",
  missing_item: "A document leaves blank a figure the others report.",
  baseline_anomaly: "Documents agree, but the change from last year's audited figure is unusually large.",
};

/** The difference as people would say it: a factor for unit errors ("÷1,000"), else a percentage. */
export function diffText(type: string, expected: number | null, reported: number | null): string | null {
  if (type === "sign_error") return "opposite sign";
  if (type === "unit_error" && expected && reported) {
    const ratio = reported / expected;
    const factor = Math.round(ratio >= 1 ? ratio : 1 / ratio);
    if (factor >= 10) return `${ratio >= 1 ? "×" : "÷"}${factor.toLocaleString("en-US")}`;
  }
  return pctDiff(expected, reported);
}

const LOGO_COLOURS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#0d9488", "#2563eb", "#65a30d"];

/** A stable colour per company, for its initials badge. */
export function companyColour(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LOGO_COLOURS[h % LOGO_COLOURS.length];
}

/** "Aster Consumer Corp." -> "AC" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Share as a whole percentage, never hiding a small non-zero share as "0%". */
export function pctOf(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}
