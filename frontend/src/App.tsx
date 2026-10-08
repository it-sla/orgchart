import { useEffect, useMemo, useRef, useState } from "react";
import { api, currentCompany, selectCompany, imgUrl, type CompanyInfo, type Employee, type EmployeeInput, type Department, type Settings } from "./api";
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
      <details className="advanced"><summary>Advanced</summary>
      <div className="row"><label>Display order<input type="number" value={f.display_order} onChange={(e) => set("display_order", Number(e.target.value))} /></label></div>
      </details>
      <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> Active</label>
      {!f.is_active && initial.is_active && <p className="notice">Direct reports will move to this employee's manager when you save.</p>}
    </fieldset>
    {err && <p className="err" role="alert">{err}</p>}
    {discarding && <div className="notice" role="alert"><p>Discard your unsaved employee changes?</p><div className="row"><button type="button" className="btn" onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="btn danger" onClick={() => onDone()}>Discard changes</button></div></div>}
    <div className="row end"><button type="button" className="btn" disabled={busy} onClick={cancel}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div>
  </form></div>;
}
function Employees({ initialDepartment = "" }: { initialDepartment?: string }) {
  const PAGE = 50;
  const [departments, setDepartments] = useState<Department[]>([]);
  const [all, setAll] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; init: EmployeeInput } | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "setup" | "inactive">("all");
  const [department, setDepartment] = useState(initialDepartment);
  const [role, setRole] = useState("");
  const [board, setBoard] = useState("all");
  const [manager, setManager] = useState("");
  const [sort, setSort] = useState("order");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkTitle, setBulkTitle] = useState("");
  const load = async (quiet = false) => { if (!quiet) setLoading(true); setError(""); try { const [employees, departmentList] = await Promise.all([api.employees(), api.departments()]); setAll(employees); setDepartments(departmentList); } catch (e) { setError(message(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPage(1); }, [query, tab, board, role, department, manager, sort]);
  useEffect(() => { if (!toast || toast.bad) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const name = (id: number | null) => id ? byId.get(id)?.name ?? "Unknown manager" : "Top of hierarchy";
  const needsSetup = (e: Employee) => e.is_active && (e.department_id === null || (e.reports_to_id === null && !e.is_board_member));
  const setupCount = all.filter(needsSetup).length;
  const titles = useMemo(() => [...new Set(all.map((e) => e.designation).filter(Boolean))].sort(), [all]);
  const filtered = all.filter((e) => `${e.name} ${e.designation} ${e.department_name ?? "Unassigned"} ${name(e.reports_to_id)}`.toLowerCase().includes(query.trim().toLowerCase()) && (tab === "all" || (tab === "setup" ? needsSetup(e) : !e.is_active)) && (board === "all" || e.is_board_member === (board === "yes")) && (!department || (department === "none" ? e.department_id === null : e.department_id === Number(department))) && (!role || (role === "none" ? !e.designation : e.designation === role)) && (!manager || (manager === "none" ? e.reports_to_id === null : e.reports_to_id === Number(manager))));
  if (sort !== "order") filtered.sort((a, b) => sort === "name-desc" ? b.name.localeCompare(a.name) : sort === "role" ? a.designation.localeCompare(b.designation) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE)), current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);
  const below = (ids: Iterable<number>) => { const s = new Set<number>(ids); let c = true; while (c) { c = false; for (const p of all) if (p.reports_to_id !== null && s.has(p.reports_to_id) && !s.has(p.id)) { s.add(p.id); c = true; } } return s; };
  const patch = (e: Employee, change: Partial<EmployeeInput>) => { const { id, name: n, designation, photo_path, reports_to_id, is_board_member, board_order, display_order, is_active, department_id } = e; return api.update(id, { name: n, designation, photo_path, reports_to_id, is_board_member, board_order, display_order, is_active, department_id, ...change }); };
  const quickSave = async (e: Employee, change: Partial<EmployeeInput>) => {
    setBusy(true); setToast(null);
    try { await patch(e, change); setToast({ text: `${e.name} updated.` }); await load(true); } catch (x) { setToast({ text: message(x), bad: true }); } finally { setBusy(false); }
  };
  const boardList = all.filter((e) => e.is_active && e.is_board_member).sort((a, b) => a.board_order - b.board_order || a.name.localeCompare(b.name));
  const moveBoard = async (i: number, d: number) => {
    const order = [...boardList]; [order[i], order[i + d]] = [order[i + d], order[i]];
    setBusy(true); setToast(null);
    try { for (const [k, p] of order.entries()) if (p.board_order !== k + 1) await patch(p, { board_order: k + 1 }); await load(true); } catch (x) { setToast({ text: message(x), bad: true }); } finally { setBusy(false); }
  };
  const bulk = async (change: Partial<EmployeeInput>, label: string) => {
    const people = all.filter((e) => picked.has(e.id)); let done = 0;
    setBusy(true); setToast(null);
    try { for (const e of people) { await patch(e, change); done++; } setToast({ text: `${label}: ${done} people updated.` }); setPicked(new Set()); setBulkTitle(""); }
    catch (x) { setToast({ text: `${label}: stopped after ${done} of ${people.length}. ${message(x)}`, bad: true }); }
    finally { await load(true); setBusy(false); }
  };
  const remove = async (e: Employee) => {
    const reports = all.filter((p) => p.reports_to_id === e.id);
    if (!confirm(e.is_active ? `Deactivate ${e.name}? ${reports.length} direct reports will move to ${name(e.reports_to_id)}.` : `Permanently delete ${e.name}? This cannot be undone.`)) return;
    setBusy(true); setToast(null);
    try { await api.remove(e.id, !e.is_active); setToast({ text: e.is_active ? "Employee deactivated." : "Employee deleted." }); await load(true); } catch (x) { setToast({ text: message(x), bad: true }); } finally { setBusy(false); }
  };
  const deactivatePicked = () => { if (confirm(`Deactivate ${picked.size} people? Their direct reports move up to their managers.`)) void bulk({ is_active: false }, "Deactivate"); };
  const allShownPicked = shown.length > 0 && shown.every((e) => picked.has(e.id));
  const togglePage = () => setPicked((p) => { const n = new Set(p); shown.forEach((e) => allShownPicked ? n.delete(e.id) : n.add(e.id)); return n; });
  const toggleOne = (id: number) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const noManager = below(picked);
  const activeDepartments = departments.filter((d) => d.is_active);
  const filtersOn = [department, role, manager].some(Boolean) || board !== "all" || sort !== "order";
  return <div className="pad directory wide"><div className="row between"><div><h1>Employees</h1><p className="muted">{all.length} people · {setupCount} still need a department or manager. Tip: tick people to set them all at once.</p></div><button className="btn primary" disabled={loading || !!error} onClick={() => setEditing({ init: { ...blank, department_id: departments.some((d) => d.is_active && String(d.id) === department) ? Number(department) : null } })}>Add employee</button></div>
    {error ? <Failure error={error} retry={() => void load()} /> : loading ? <p role="status">Loading employees...</p> : <>
      {boardList.length > 1 && <details className="board-order" open><summary>Board of Directors order ({boardList.length})</summary><p className="muted">Top of this list is shown first in the chart. Use the arrows to move someone.</p><ol>{boardList.map((p, i) => <li key={p.id}><span className="rank">{i + 1}</span><b>{p.name}</b><span className="muted">{p.designation}</span><button className="btn" disabled={busy || i === 0} aria-label={`Move ${p.name} up`} onClick={() => void moveBoard(i, -1)}>↑</button><button className="btn" disabled={busy || i === boardList.length - 1} aria-label={`Move ${p.name} down`} onClick={() => void moveBoard(i, 1)}>↓</button></li>)}</ol></details>}
      <div className="directory-bar">
        <div className="tabs" role="tablist" aria-label="Employee list">
          {([["all", `All (${all.length})`], ["setup", `Needs setup (${setupCount})`], ["inactive", `Inactive (${all.filter((e) => !e.is_active).length})`]] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>)}
        </div>
        <label className="directory-search">Search<input placeholder="Name, designation, department or manager" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      <details className="more-filters" open={filtersOn || undefined}><summary>More filters{filtersOn ? " (active)" : ""}</summary>
        <div className="directory-filters">
          <label>Department<select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">All departments</option><option value="none">Unassigned</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}{!d.is_active ? " (archived)" : ""}</option>)}</select></label>
          <label>Designation / role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All designations</option><option value="none">No designation</option>{titles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label>Manager<select value={manager} onChange={(e) => setManager(e.target.value)}><option value="">All managers</option><option value="none">Top of hierarchy</option>{all.filter((e) => all.some((r) => r.reports_to_id === e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>Board<select value={board} onChange={(e) => setBoard(e.target.value)}><option value="all">Everyone</option><option value="yes">Board members</option><option value="no">Non-board members</option></select></label>
          <label>Sort<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="order">Display order</option><option value="name">Name A-Z</option><option value="name-desc">Name Z-A</option><option value="role">Designation / role</option></select></label>
          <button className="btn" onClick={() => { setDepartment(""); setRole(""); setManager(""); setBoard("all"); setSort("order"); }}>Clear filters</button>
        </div>
      </details>
      {picked.size > 0 && <div className="bulk-bar" role="region" aria-label="Bulk actions">
        <b>{picked.size} selected</b>
        <label>Reports to<select disabled={busy} value="" onChange={(x) => { if (x.target.value !== "") void bulk({ reports_to_id: x.target.value === "top" ? null : Number(x.target.value) }, "Reports to"); }}><option value="">Choose...</option><option value="top">None - top of hierarchy</option>{all.filter((m) => m.is_active && !noManager.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} - {m.designation}</option>)}</select></label>
        <label>Department<select disabled={busy} value="" onChange={(x) => { if (x.target.value !== "") void bulk({ department_id: x.target.value === "none" ? null : Number(x.target.value) }, "Department"); }}><option value="">Choose...</option><option value="none">Unassigned</option>{activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Designation / role<span className="row"><input list="employee-titles" maxLength={200} disabled={busy} value={bulkTitle} onChange={(x) => setBulkTitle(x.target.value)} placeholder="Pick or type" /><button className="btn" disabled={busy || !bulkTitle.trim()} onClick={() => void bulk({ designation: bulkTitle.trim() }, "Designation")}>Apply</button></span></label>
        <button className="btn danger" disabled={busy} onClick={deactivatePicked}>Deactivate</button>
        <button className="btn" disabled={busy} onClick={() => setPicked(new Set())}>Clear</button>
      </div>}
      <datalist id="employee-titles">{titles.map((t) => <option key={t} value={t} />)}</datalist>
      {shown.length ? <div className="table-wrap"><table className="emp-table">
        <thead><tr><th><input type="checkbox" aria-label="Select everyone on this page" checked={allShownPicked} onChange={togglePage} /></th><th>Name</th><th>Designation / role</th><th>Department</th><th>Reports to</th><th>Board</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{shown.map((e) => <tr key={e.id} className={(picked.has(e.id) ? "picked " : "") + (!e.is_active ? "inactive" : "")}>
          <td><input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.id)} onChange={() => toggleOne(e.id)} /></td>
          <td><div className="who"><Avatar e={e} size={32} /><div><b>{e.name}</b>{!e.is_active && <small>Inactive</small>}</div></div></td>
          <td><input aria-label={`Designation / role for ${e.name}`} list="employee-titles" maxLength={200} disabled={busy} key={e.id + e.designation} defaultValue={e.designation} placeholder="Pick or type" onBlur={(x) => { const v = x.target.value.trim(); if (v !== e.designation) void quickSave(e, { designation: v }); }} onKeyDown={(x) => { if (x.key === "Enter") x.currentTarget.blur(); else if (x.key === "Escape") { x.currentTarget.value = e.designation; x.currentTarget.blur(); } }} /></td>
          <td><select aria-label={`Department for ${e.name}`} disabled={busy} value={e.department_id ?? ""} onChange={(x) => void quickSave(e, { department_id: x.target.value ? Number(x.target.value) : null })}><option value="">Unassigned</option>{departments.filter((d) => d.is_active || d.id === e.department_id).map((d) => <option key={d.id} value={d.id}>{d.name}{!d.is_active ? " (archived)" : ""}</option>)}</select></td>
          <td><select aria-label={`Reports to for ${e.name}`} disabled={busy} value={e.reports_to_id ?? ""} onChange={(x) => void quickSave(e, { reports_to_id: x.target.value ? Number(x.target.value) : null })}><option value="">None - top of hierarchy</option>{all.filter((m) => m.is_active && m.id !== e.id && !below([e.id]).has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} - {m.designation}</option>)}</select></td>
          <td className="board-cell"><input type="checkbox" aria-label={`${e.name} is a board member`} disabled={busy} checked={e.is_board_member} onChange={(x) => void quickSave(e, { is_board_member: x.target.checked })} /></td>
          <td className="actions"><button className="btn" disabled={busy} onClick={() => setEditing({ id: e.id, init: e })}>Edit<span className="sr-only"> {e.name}</span></button><button className={"btn " + (!e.is_active ? "danger" : "")} disabled={busy} onClick={() => void remove(e)}>{e.is_active ? "Deactivate" : "Delete"}<span className="sr-only"> {e.name}</span></button></td>
        </tr>)}</tbody>
      </table></div> : <p className="notice">{all.length ? (tab === "setup" ? "Everyone is set up." : "No employees match these filters.") : "No employees yet. Add your first person to get started."}</p>}
      <div className="pagination"><button className="btn" disabled={current === 1} onClick={() => { setPage(current - 1); document.querySelector("main")?.scrollTo({ top: 0 }); }}>Previous</button><span>{filtered.length} shown · Page {current} of {pages}</span><button className="btn" disabled={current === pages} onClick={() => { setPage(current + 1); document.querySelector("main")?.scrollTo({ top: 0 }); }}>Next</button></div>
    </>}
    {toast && <div className={"toast" + (toast.bad ? " bad" : "")} role={toast.bad ? "alert" : "status"}>{toast.text}{toast.bad && <button className="btn" onClick={() => setToast(null)}>Dismiss</button>}</div>}
    {editing && <EmployeeForm initial={editing.init} id={editing.id} all={all} departments={departments} onDone={(saved) => { setEditing(null); if (saved) { setToast({ text: "Employee saved." }); void load(true); } }} />}
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
function AddCompany({ onCreated, onCancel }: { onCreated: (c: CompanyInfo) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) { setErr("Enter a company name."); return; }
    setBusy(true); setErr("");
    try { onCreated(await api.createCompany(name.trim())); } catch (e) { setErr(message(e)); setBusy(false); }
  };
  return <div className="modal"><form className="card form" role="dialog" aria-modal="true" aria-labelledby="add-company-title" onSubmit={submit} onKeyDown={(ev) => { if (ev.key === "Escape") onCancel(); }}>
    <h3 id="add-company-title">Add company</h3>
    <label>Company name<input autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
    <p className="muted">Each company has its own employees, departments and chart. You can add a logo in Company Settings afterwards.</p>
    {err && <p className="err" role="alert">{err}</p>}
    <div className="row end"><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Adding..." : "Add company"}</button></div>
  </form></div>;
}
export default function App() {
  const [page, setPage] = useState<(typeof pages)[number]>("Organization Chart");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [company, setCompany] = useState<Settings | null>(null);
  const [brandError, setBrandError] = useState("");
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [companyId, setCompanyId] = useState(currentCompany);
  const [adding, setAdding] = useState(false);
  const switchTo = (id: number) => { selectCompany(id); setCompanyId(id); setDepartmentFilter(""); };
  const loadCompany = async () => { setBrandError(""); try { setCompany(await api.settings()); } catch (e) { setBrandError(message(e)); } };
  const loadCompanies = async () => { try { const list = await api.companies(); setCompanies(list); if (list.length && !list.some((c) => c.id === currentCompany())) switchTo(list[0].id); } catch { /* the brand error banner covers load failures */ } };
  useEffect(() => { void loadCompany(); void loadCompanies(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="app"><header><div className="brand">{company?.logo_path && <img src={imgUrl(company.logo_path)} alt="" />}{companies.length ? <label className="company-switch"><span className="sr-only">Company</span><select value={companyId} onChange={(e) => e.target.value === "add" ? setAdding(true) : switchTo(Number(e.target.value))}>{companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}<option value="add">+ Add company...</option></select></label> : <b>{company?.company_name || "Organization"}</b>}</div><nav aria-label="Main navigation">{pages.map((p) => <button key={p} aria-current={p === page ? "page" : undefined} className={p === page ? "on" : ""} onClick={() => { if (p === "Employees") setDepartmentFilter(""); setPage(p); }}>{p}</button>)}</nav></header>
    {brandError && <div className="brand-error" role="alert">Company details could not load. <button className="btn" onClick={() => void loadCompany()}>Retry</button></div>}
    <main key={companyId}>{page === "Organization Chart" && <OrgChart />}{page === "Employees" && <Employees key={departmentFilter} initialDepartment={departmentFilter} />}{page === "Departments" && <Departments onViewEmployees={(id) => { setDepartmentFilter(String(id)); setPage("Employees"); }} />}{page === "Company Settings" && <CompanySettings onSaved={() => { void loadCompany(); void loadCompanies(); }} />}</main>
    {adding && <AddCompany onCancel={() => setAdding(false)} onCreated={(c) => { setAdding(false); switchTo(c.id); }} />}
  </div>;
}
