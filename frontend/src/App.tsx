import { useEffect, useMemo, useRef, useState } from "react";
import { api, imgUrl, type Employee, type EmployeeInput, type Department, type Settings } from "./api";
import OrgChart, { Avatar } from "./OrgChart";
import Departments from "./Departments";

const blank: EmployeeInput = { name: "", designation: "", department_id: null, photo_path: null, reports_to_id: null, is_board_member: false, board_order: 0, display_order: 0, is_active: true };
const message = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please try again.";
function Failure({ error, retry }: { error: string; retry: () => void }) {
  return <div className="notice error" role="alert"><p>{error}</p><button className="btn" onClick={retry}>Retry</button></div>;
}
function useFilePreview(file: File | null) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!file) { setUrl(undefined); return; } const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return url;
}
function chooseImage(file: File | undefined) {
  if (!file) return null;
  if (file.size > 5_000_000) throw new Error("Choose an image smaller than 5 MB.");
  if (!/\.(png|jpe?g|gif|webp)$/i.test(file.name)) throw new Error("Choose a PNG, JPG, GIF, or WebP image.");
  return file;
}
function EmployeeForm({ initial, id, all, departments, onDone }: { initial: EmployeeInput; id?: number; all: Employee[]; departments: Department[]; onDone: (saved?: boolean) => void }) {
  const [f, setF] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLFormElement>(null);
  const preview = useFilePreview(file);
  const [discarding, setDiscarding] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial) || !!file;
  const cancel = () => { if (lock.current) return; if (dirty) setDiscarding(true); else onDone(); };
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLInputElement>("input")?.focus(); return () => previous?.focus(); }, []);
  const forbidden = useMemo(() => {
    const ids = new Set<number>(id ? [id] : []);
    let changed = true;
    while (changed) { changed = false; for (const e of all) if (e.reports_to_id !== null && ids.has(e.reports_to_id) && !ids.has(e.id)) { ids.add(e.id); changed = true; } }
    return ids;
  }, [all, id]);
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (lock.current) return;
    if (!f.name.trim()) { setErr("Enter an employee name."); return; }
    lock.current = true; setBusy(true); setErr("");
    try { const photo_path = file ? await api.upload("photo", file) : f.photo_path; const body = { ...f, name: f.name.trim(), designation: f.designation.trim(), photo_path }; await (id ? api.update(id, body) : api.create(body)); onDone(true); }
    catch (e) { setErr(message(e)); } finally { lock.current = false; setBusy(false); }
  };
  return <div className="modal"><form ref={dialog} className="card form" role="dialog" aria-modal="true" aria-labelledby="employee-form-title" onSubmit={submit} onKeyDown={(ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    if (ev.key === "Tab") { const targets = Array.from(dialog.current!.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')); const first = targets[0], last = targets[targets.length - 1]; if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); } }
  }}>
    <h3 id="employee-form-title">{id ? "Edit employee" : "Add employee"}</h3>
    <fieldset disabled={busy} className="form-fields">
      <label>Name<input required maxLength={200} value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label>Department<select value={f.department_id ?? ""} onChange={(e) => set("department_id", e.target.value ? Number(e.target.value) : null)}><option value="">Unassigned</option>{departments.filter((d) => d.is_active || d.id === initial.department_id).map((d) => <option key={d.id} value={d.id} disabled={!d.is_active}>{d.name}{!d.is_active ? " (archived)" : ""}</option>)}</select><small>{departments.some((d) => d.is_active) ? "Select the department this employee belongs to." : "Create departments on the Departments page, then assign your people."}</small></label>
      <label>Designation / role<input maxLength={200} list="designation-options" value={f.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. Sales Manager" /><small>Job title or role. Select an existing title or enter a new one.</small></label>
      <datalist id="designation-options">{[...new Set(all.map((e) => e.designation).filter(Boolean))].sort().map((title) => <option key={title} value={title} />)}</datalist>
      <label>Photo<div className="row">{preview ? <img className="avatar" src={preview} width={44} height={44} alt="Selected employee photo" /> : <Avatar e={f} />}<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" onChange={(e) => { try { setFile(chooseImage(e.target.files?.[0])); setErr(""); } catch (x) { setErr(message(x)); e.target.value = ""; } }} /></div><small>PNG, JPG, GIF, or WebP. Up to 5 MB. Uploaded when you save.</small></label>
      {(file || f.photo_path) && <button className="btn" type="button" onClick={() => { setFile(null); set("photo_path", null); }}>Remove photo</button>}
      <label>Reports to<select value={f.reports_to_id ?? ""} onChange={(e) => set("reports_to_id", e.target.value ? Number(e.target.value) : null)}><option value="">None - top of hierarchy</option>{all.filter((e) => e.is_active && !forbidden.has(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name} - {e.designation}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={f.is_board_member} onChange={(e) => set("is_board_member", e.target.checked)} /> Board member</label>
      <div className="row"><label>Board order<input type="number" value={f.board_order} onChange={(e) => set("board_order", Number(e.target.value))} /></label><label>Display order<input type="number" value={f.display_order} onChange={(e) => set("display_order", Number(e.target.value))} /></label></div>
      <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> Active</label>
      {!f.is_active && initial.is_active && <p className="notice">Direct reports will move to this employee's manager when you save.</p>}
    </fieldset>
    {err && <p className="err" role="alert">{err}</p>}
    {discarding && <div className="notice" role="alert"><p>Discard your unsaved employee changes?</p><div className="row"><button type="button" className="btn" onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="btn danger" onClick={() => onDone()}>Discard changes</button></div></div>}
    <div className="row end"><button type="button" className="btn" disabled={busy} onClick={cancel}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div>
  </form></div>;
}
function Employees({ initialDepartment = "" }: { initialDepartment?: string }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [department, setDepartment] = useState(initialDepartment);
  const [all, setAll] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id?: number; init: EmployeeInput } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [board, setBoard] = useState("all");
  const [role, setRole] = useState("");
  const [manager, setManager] = useState("");
  const [sort, setSort] = useState("order");
  const [page, setPage] = useState(1);
  const load = async () => { setLoading(true); setError(""); try { const [employees, departmentList] = await Promise.all([api.employees(), api.departments()]); setAll(employees); setDepartments(departmentList); } catch (e) { setError(message(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPage(1); }, [query, status, board, role, department, manager, sort]);
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const name = (id: number | null) => id ? byId.get(id)?.name ?? "Unknown manager" : "Top of hierarchy";
  const filtered = all.filter((e) => `${e.name} ${e.designation} ${e.department_name ?? "Unassigned"} ${name(e.reports_to_id)}`.toLowerCase().includes(query.trim().toLowerCase()) && (status === "all" || e.is_active === (status === "active")) && (board === "all" || e.is_board_member === (board === "yes")) && (!department || (department === "none" ? e.department_id === null : e.department_id === Number(department))) && (!role || (role === "none" ? !e.designation : e.designation === role)) && (!manager || (manager === "none" ? e.reports_to_id === null : e.reports_to_id === Number(manager))));
  if (sort !== "order") filtered.sort((a, b) => sort === "name-desc" ? b.name.localeCompare(a.name) : sort === "role" ? a.designation.localeCompare(b.designation) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(filtered.length / 15)), current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * 15, current * 15);
  const below = (id: number) => { const s = new Set<number>(); let c = true; while (c) { c = false; for (const p of all) if (p.reports_to_id !== null && (p.reports_to_id === id || s.has(p.reports_to_id)) && !s.has(p.id)) { s.add(p.id); c = true; } } return s; };
  const quickSave = async (e: Employee, change: Partial<EmployeeInput>) => {
    setBusyId(e.id); setActionError(""); setNotice("");
    try { const { id, name: n, designation, photo_path, reports_to_id, is_board_member, board_order, display_order, is_active, department_id } = e; await api.update(id, { name: n, designation, photo_path, reports_to_id, is_board_member, board_order, display_order, is_active, department_id, ...change }); setNotice(`${e.name} updated.`); await load(); } catch (x) { setActionError(message(x)); } finally { setBusyId(null); }
  };
  const remove = async (e: Employee) => {
    const reports = all.filter((p) => p.reports_to_id === e.id);
    if (!confirm(e.is_active ? `Deactivate ${e.name}? ${reports.length} direct reports will move to ${name(e.reports_to_id)}.` : `Permanently delete ${e.name}? This cannot be undone.`)) return;
    setBusyId(e.id); setActionError(""); setNotice("");
    try { await api.remove(e.id, !e.is_active); setNotice(e.is_active ? "Employee deactivated." : "Employee deleted."); await load(); } catch (x) { setActionError(message(x)); } finally { setBusyId(null); }
  };
  return <div className="pad directory"><div className="row between"><div><h1>Employees</h1><p className="muted">Manage departments, job titles and reporting relationships.</p></div><button className="btn primary" disabled={loading || !!error} onClick={() => setEditing({ init: { ...blank, department_id: departments.some((d) => d.is_active && String(d.id) === department) ? Number(department) : null } })}>Add employee</button></div>
    {error ? <Failure error={error} retry={() => void load()} /> : loading ? <p role="status">Loading employees...</p> : <>
      <div className="directory-filters">
        <label className="directory-search">Search<input placeholder="Name, department, designation, or manager" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label>Board<select value={board} onChange={(e) => setBoard(e.target.value)}><option value="all">Everyone</option><option value="yes">Board members</option><option value="no">Non-board members</option></select></label>
        <label>Department<select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">All departments</option><option value="none">Unassigned</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}{!d.is_active ? " (archived)" : ""}</option>)}</select></label>
        <label>Designation / role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All designations</option><option value="none">No designation</option>{[...new Set(all.map((e) => e.designation).filter(Boolean))].sort().map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label>Manager<select value={manager} onChange={(e) => setManager(e.target.value)}><option value="">All managers</option><option value="none">Top of hierarchy</option>{all.filter((e) => all.some((r) => r.reports_to_id === e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Sort<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="order">Display order</option><option value="name">Name A-Z</option><option value="name-desc">Name Z-A</option><option value="role">Designation / role</option></select></label>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}{actionError && <p className="err" role="alert">{actionError}</p>}
      <div className="row between"><p className="muted" role="status">{filtered.length} of {all.length} employees · {all.filter((e) => e.department_id === null).length} unassigned</p><button className="btn" onClick={() => { setQuery(""); setStatus("all"); setBoard("all"); setDepartment(""); setRole(""); setManager(""); setSort("order"); }}>Clear filters</button></div>
      {shown.length ? <div className="employee-list">{shown.map((e) => <article className="employee-card" key={e.id}>
        <div className="employee-identity"><Avatar e={e} /><div><h2>{e.name}</h2><p>{e.designation || "No designation"}</p><span className={"status-tag " + (e.is_active ? "active" : "")}>{e.is_active ? "Active" : "Inactive"}{e.is_board_member ? " | Board member" : ""}</span></div></div>
        <div className="employee-manager">
          <label>Department<select disabled={busyId !== null} value={e.department_id ?? ""} onChange={(x) => void quickSave(e, { department_id: x.target.value ? Number(x.target.value) : null })}><option value="">Unassigned</option>{departments.filter((d) => d.is_active || d.id === e.department_id).map((d) => <option key={d.id} value={d.id}>{d.name}{!d.is_active ? " (archived)" : ""}</option>)}</select></label>
          <label>Reports to<select disabled={busyId !== null} value={e.reports_to_id ?? ""} onChange={(x) => void quickSave(e, { reports_to_id: x.target.value ? Number(x.target.value) : null })}><option value="">None - top of hierarchy</option>{all.filter((m) => m.is_active && m.id !== e.id && !below(e.id).has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} - {m.designation}</option>)}</select></label>
        </div>
        <div className="actions"><button className="btn" disabled={busyId !== null} onClick={() => setEditing({ id: e.id, init: e })}>Edit<span className="sr-only"> {e.name}</span></button><button className={"btn " + (!e.is_active ? "danger" : "")} disabled={busyId !== null} onClick={() => void remove(e)}>{busyId === e.id ? "Working..." : e.is_active ? "Deactivate" : "Delete"}<span className="sr-only"> {e.name}</span></button></div>
      </article>)}</div> : <p className="notice">{all.length ? "No employees match these filters." : "No employees yet. Add your first person to get started."}</p>}
      <div className="pagination"><button className="btn" disabled={current === 1} onClick={() => { setPage(current - 1); document.querySelector("main")?.scrollTo({ top: 0 }); }}>Previous</button><span>Page {current} of {pages}</span><button className="btn" disabled={current === pages} onClick={() => { setPage(current + 1); document.querySelector("main")?.scrollTo({ top: 0 }); }}>Next</button></div>
    </>}
    {editing && <EmployeeForm initial={editing.init} id={editing.id} all={all} departments={departments} onDone={(saved) => { setEditing(null); if (saved) { setNotice("Employee saved."); void load(); } }} />}
  </div>;
}
function CompanySettings({ onSaved }: { onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const preview = useFilePreview(file);
  const load = async () => { setError(""); try { setS(await api.settings()); } catch (e) { setError(message(e)); } };
  useEffect(() => { void load(); }, []);
  return <div className="pad settings"><h1>Company settings</h1>{error ? <Failure error={error} retry={() => void load()} /> : !s ? <p role="status">Loading settings...</p> : <form className="card form" onSubmit={async (e) => {
    e.preventDefault(); if (lock.current) return;
    if (!s.company_name.trim()) { setMsg("Enter a company name."); return; }
    lock.current = true; setBusy(true); setMsg("");
    try { const logo_path = file ? await api.upload("logo", file) : s.logo_path; const saved = await api.saveSettings({ ...s, company_name: s.company_name.trim(), logo_path }); setS(saved); setFile(null); setMsg("Company settings saved."); onSaved(); } catch (x) { setMsg(message(x)); } finally { lock.current = false; setBusy(false); }
  }}>
    <fieldset className="form-fields" disabled={busy}>
      <label>Company name<input required maxLength={200} value={s.company_name} onChange={(e) => { setS({ ...s, company_name: e.target.value }); setMsg(""); }} /></label>
      <label>Logo{(preview || s.logo_path) && <img className="logo-preview" src={preview ?? imgUrl(s.logo_path)} alt="Company logo preview" />}<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" onChange={(e) => { try { setFile(chooseImage(e.target.files?.[0])); setMsg(""); } catch (x) { setMsg(message(x)); e.target.value = ""; } }} /><small>Up to 5 MB. Uploaded when you save.</small></label>
      {(file || s.logo_path) && <button type="button" className="btn" onClick={() => { setFile(null); setS({ ...s, logo_path: null }); }}>Remove logo</button>}
    </fieldset>
    <button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>{msg && <p role="status">{msg}</p>}
  </form>}</div>;
}
const pages = ["Organization Chart", "Employees", "Departments", "Company Settings"] as const;
export default function App() {
  const [page, setPage] = useState<(typeof pages)[number]>("Organization Chart");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [company, setCompany] = useState<Settings | null>(null);
  const [brandError, setBrandError] = useState("");
  const loadCompany = async () => { setBrandError(""); try { setCompany(await api.settings()); } catch (e) { setBrandError(message(e)); } };
  useEffect(() => { void loadCompany(); }, []);
  return <div className="app"><header><div className="brand">{company?.logo_path && <img src={imgUrl(company.logo_path)} alt="" />}<b>{company?.company_name || "Organization"}</b></div><nav aria-label="Main navigation">{pages.map((p) => <button key={p} aria-current={p === page ? "page" : undefined} className={p === page ? "on" : ""} onClick={() => { if (p === "Employees") setDepartmentFilter(""); setPage(p); }}>{p}</button>)}</nav></header>
    {brandError && <div className="brand-error" role="alert">Company details could not load. <button className="btn" onClick={() => void loadCompany()}>Retry</button></div>}
    <main>{page === "Organization Chart" && <OrgChart />}{page === "Employees" && <Employees key={departmentFilter} initialDepartment={departmentFilter} />}{page === "Departments" && <Departments onViewEmployees={(id) => { setDepartmentFilter(String(id)); setPage("Employees"); }} />}{page === "Company Settings" && <CompanySettings onSaved={() => void loadCompany()} />}</main>
  </div>;
}
