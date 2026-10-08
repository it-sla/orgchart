export type Employee = {
  id: number;
  name: string;
  designation: string;
  department_id: number | null;
  department_name: string | null;
  photo_path: string | null;
  reports_to_id: number | null;
  is_board_member: boolean;
  board_order: number;
  display_order: number;
  is_active: boolean;
  created_at: string;
};
export type EmployeeInput = Omit<Employee, "id" | "created_at" | "department_name">;
export type Department = { id: number; name: string; description: string; is_active: boolean; employee_count: number; active_employee_count: number };
export type DepartmentInput = Pick<Department, "name" | "description" | "is_active">;
export type Settings = { id: number; company_name: string; logo_path: string | null };
export type CompanyInfo = Settings & { employee_count: number };
export type OrgChartData = {
  company: Settings;
  board: Employee[];
  nodes: Employee[];
  edges: { source: number; target: number }[];
};

export const imgUrl = (p: string | null) => (p ? `/uploads/${p}` : undefined);

// The selected company travels with every request as X-Company-Id.
const COMPANY_KEY = "orgchart-company";
let companyId = 1;
try { companyId = Number(localStorage.getItem(COMPANY_KEY)) || 1; } catch { /* storage unavailable: default company */ }
export const currentCompany = () => companyId;
export const selectCompany = (id: number) => { companyId = id; try { localStorage.setItem(COMPANY_KEY, String(id)); } catch { /* not remembered */ } };
const withCompany = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string>), "X-Company-Id": String(companyId) } });

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, withCompany(init));
  if (!r.ok) {
    throw await responseError(r);
  }
  return r.json();
}
async function responseError(r: Response) {
  const d = await r.json().catch(() => ({}));
  return new Error(typeof d.detail === "string" ? d.detail : Array.isArray(d.detail)
    ? d.detail.map((e: { loc: string[]; msg: string }) => `${e.loc.slice(1).join(".")}: ${e.msg}`).join("; ")
    : `Request failed (${r.status})`);
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  companies: () => req<CompanyInfo[]>("/api/companies"),
  createCompany: (company_name: string) => req<CompanyInfo>("/api/companies", json("POST", { company_name })),
  departments: () => req<Department[]>("/api/departments"),
  department: (id: number) => req<Department>(`/api/departments/${id}`),
  createDepartment: (d: DepartmentInput) => req<Department>("/api/departments", json("POST", d)),
  updateDepartment: (id: number, d: DepartmentInput) => req<Department>(`/api/departments/${id}`, json("PUT", d)),
  removeDepartment: (id: number, hard = false) => req(`/api/departments/${id}?hard=${hard}`, { method: "DELETE" }),
  exportPdf: async (options: { scope: "full" | "visible"; ids: number[]; paper: string; orientation: string; layout: string; positions: { id: string; x: number; y: number; depth: number; stacked?: boolean; label?: string }[] }) => {
    const r = await fetch("/api/export/pdf", withCompany(json("POST", options)));
    if (!r.ok) throw await responseError(r);
    return r.blob();
  },
  employees: () => req<Employee[]>("/api/employees"),
  employee: (id: number) => req<Employee>(`/api/employees/${id}`),
  create: (e: EmployeeInput) => req<Employee>("/api/employees", json("POST", e)),
  update: (id: number, e: EmployeeInput) => req<Employee>(`/api/employees/${id}`, json("PUT", e)),
  remove: (id: number, hard = false) => req(`/api/employees/${id}?hard=${hard}`, { method: "DELETE" }),
  manager: (id: number) => req<Employee | null>(`/api/employees/${id}/manager`),
  reports: (id: number) => req<Employee[]>(`/api/employees/${id}/direct-reports`),
  chain: (id: number) => req<Employee[]>(`/api/employees/${id}/reporting-chain`),
  orgChart: () => req<OrgChartData>("/api/org-chart"),
  settings: () => req<Settings>("/api/settings"),
  saveSettings: (s: Omit<Settings, "id">) => req<Settings>("/api/settings", json("PUT", s)),
  upload: async (kind: "photo" | "logo", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return (await req<{ path: string }>(`/api/upload/${kind}`, { method: "POST", body: fd })).path;
  },
};
