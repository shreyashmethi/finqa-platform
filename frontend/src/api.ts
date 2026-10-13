// Typed API client. Every request carries the bearer token of the signed-in user; errors are
// turned into ApiError with the server's "detail" message so screens can show it verbatim.
import type {
  AuditPage,
  Company,
  CompanyInput,
  DecisionAction,
  ExceptionDetail,
  ExceptionPage,
  Me,
  Rules,
  RunDetail,
  Run,
  SetDetail,
  SetSummary,
  Reports,
  Summary,
  SystemStatus,
  ToolCall,
  ToolSchema,
  UserInfo,
} from "./types";

const TOKEN_KEY = "finqa.token";

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

/** Fired when the server rejects the token, so the auth context can send the user to sign-in. */
export const UNAUTHORIZED_EVENT = "finqa:unauthorized";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** FastAPI validation errors arrive as a list of {loc, msg}; turn them into one readable line. */
function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = d.loc?.filter((p) => p !== "body" && p !== "query").join(".");
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join("; ");
  return JSON.stringify(detail);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check that the API is running and try again.");
  }
  if (!res.ok) {
    let detail = res.statusText || `Request failed (${res.status})`;
    try {
      detail = detailText((await res.json()).detail);
    } catch {
      /* non-JSON error body: keep statusText */
    }
    if (res.status === 401) {
      tokenStore.clear();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface ExceptionFilters {
  status?: string;
  severity?: string;
  type?: string;
  set_id?: string;
  company_id?: string;
  metric?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface RunFilters {
  set_id?: string;
  status?: string;
  created_by?: string;
  limit?: number;
  offset?: number;
}

export interface DecisionBody {
  action: DecisionAction;
  comment?: string;
  override_value?: number;
}

export const api = {
  me: () => request<Me>("/me"),
  summary: () => request<Summary>("/summary"),
  companies: () => request<Company[]>("/companies"),
  createCompany: (c: CompanyInput) => request<Company>("/companies", { method: "POST", body: JSON.stringify(c) }),
  sets: () => request<SetSummary[]>("/sets"),
  set: (id: string) => request<SetDetail>(`/sets/${encodeURIComponent(id)}`),
  uploadSet: (form: FormData) => request<SetDetail>("/sets", { method: "POST", body: form }),
  startRun: (setId: string) => request<Run>(`/sets/${encodeURIComponent(setId)}/runs`, { method: "POST" }),
  runs: (setId?: string, limit?: number) => request<Run[]>(`/runs${qs({ set_id: setId, limit })}`),
  runList: (f: RunFilters) => request<Run[]>(`/runs${qs(f as Record<string, string | number | undefined>)}`),
  decisions: (f: { username?: string; action?: string; set_id?: string; limit?: number; offset?: number }) =>
    request<AuditPage>(`/decisions${qs(f)}`),
  reports: () => request<Reports>("/reports"),
  users: () => request<UserInfo[]>("/users"),
  system: () => request<SystemStatus>("/system"),
  tools: () => request<ToolSchema[]>("/tools"),
  health: () => request<{ status: string }>("/health"),
  run: (id: string) => request<RunDetail>(`/runs/${id}`),
  toolCalls: (id: string) => request<ToolCall[]>(`/runs/${id}/tool-calls`),
  resumeRun: (id: string) => request<Run>(`/runs/${id}/resume`, { method: "POST" }),
  cancelRun: (id: string) => request<Run>(`/runs/${id}/cancel`, { method: "POST" }),
  exceptions: (f: ExceptionFilters) =>
    request<ExceptionPage>(`/exceptions${qs(f as Record<string, string | number | undefined>)}`),
  exception: (id: string) => request<ExceptionDetail>(`/exceptions/${id}`),
  decide: (id: string, body: DecisionBody) =>
    request<ExceptionDetail>(`/exceptions/${id}/decisions`, { method: "POST", body: JSON.stringify(body) }),
  rules: () => request<Rules>("/settings"),
  saveRules: (r: Partial<Rules>) => request<Rules>("/settings", { method: "PUT", body: JSON.stringify(r) }),
  sheetCells: (docId: string, sheet: string, cell: string) =>
    request<{ columns: string[]; rows: { row: number; cells: string[] }[]; highlight: { row: number; col: number } }>(
      `/documents/${docId}/cells${qs({ sheet, cell })}`,
    ),
  csvLines: (docId: string, line: number) =>
    request<{ header: string[]; rows: { line: number; cells: string[] }[]; highlight: number }>(
      `/documents/${docId}/lines${qs({ line })}`,
    ),
  /** Fetch a binary resource with auth (images, CSV export) and return an object URL. */
  blobUrl: async (path: string): Promise<string> => {
    const token = tokenStore.get();
    const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return URL.createObjectURL(await res.blob());
  },
  /** Download a protected file under ``filename`` (a plain link cannot send the bearer token). */
  download: async (path: string, filename: string) => {
    const url = await api.blobUrl(path);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
