import { useEffect, useRef, useState } from "react";
import { api, type Department, type DepartmentInput } from "./api";

const blank: DepartmentInput = { name: "", description: "", is_active: true };
const message = (error: unknown) => error instanceof Error ? error.message : "Could not save the department. Try again.";

export default function Departments({ onViewEmployees }: { onViewEmployees: (id: number) => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<DepartmentInput>(blank);
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const lock = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const load = async () => {
    setLoading(true); setLoadError("");
    try { setDepartments(await api.departments()); }
    catch (e) { setLoadError(message(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const reset = () => { setEditing(null); setForm(blank); setError(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    if (!form.name.trim()) { setError("Enter a department name."); nameInput.current?.focus(); return; }
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const saved = editing === null ? await api.createDepartment(form) : await api.updateDepartment(editing, form);
      setDepartments((items) => [...items.filter((d) => d.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setNotice(editing === null ? "Department created. You can now assign employees to it." : "Department updated. Employee assignments are preserved.");
      reset();
    } catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const changeStatus = async (department: Department) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (department.is_active) await api.removeDepartment(department.id);
      const saved = department.is_active ? await api.department(department.id) : await api.updateDepartment(department.id, { name: department.name, description: department.description, is_active: true });
      setDepartments((items) => items.map((d) => d.id === saved.id ? saved : d));
      setNotice(saved.is_active ? "Department restored." : "Department archived. Existing employee assignments are preserved.");
      setArchive(null);
      if (editing === department.id) reset();
    } catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const remove = async (department: Department) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setDeleteError(""); setNotice("");
    try {
      await api.removeDepartment(department.id, true);
      setDepartments((items) => items.filter((d) => d.id !== department.id));
      setDeleting(null);
      if (editing === department.id) reset();
      setNotice(`${department.name} deleted permanently.`);
    } catch (e) { setDeleteError(message(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const visible = departments.filter((d) => (showArchived || d.is_active) && `${d.name} ${d.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="pad departments-page">
    <div className="row between"><div><h1>Departments</h1><p className="muted">Organize your people into departments. Job designations stay on each employee.</p></div><span className="status-tag active">{departments.filter((d) => d.is_active).length} active departments</span></div>
    {loadError ? <div className="notice error" role="alert"><p>{loadError}</p><button className="btn" onClick={() => void load()}>Retry</button></div> : loading ? <p role="status">Loading departments...</p> : <>
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="department-workspace">
        <form className="card department-form" onSubmit={save}>
          <h2>{editing === null ? "Create department" : "Edit department"}</h2>
          <fieldset disabled={busy || deleting !== null} className="form-fields">
            <label>Department name<input ref={nameInput} required maxLength={100} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setError(""); }} placeholder="e.g. Operations" aria-invalid={!!error} aria-describedby="department-name-help" /></label>
            <small id="department-name-help">Use a unique name. Renaming keeps employee assignments.</small>
            <label>Description <span className="muted">(optional)</span><textarea maxLength={500} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this department do?" /></label>
          </fieldset>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="row"><button className="btn primary" disabled={busy || deleting !== null}>{busy ? "Working..." : editing === null ? "Create department" : "Save department"}</button>{editing !== null && <button className="btn" type="button" disabled={busy || deleting !== null} onClick={reset}>Cancel edit</button>}</div>
        </form>
        <section aria-label="Department directory" className="department-directory">
          <div className="department-filters"><label>Search departments<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or description" /></label><label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Include archived</label></div>
          <p className="muted" role="status">{visible.length} departments shown</p>
          {visible.length ? <div className="department-list">{visible.map((d) => <article className="card department-card" key={d.id}>
            <div className="row between"><h2>{d.name}</h2><span className={`status-tag ${d.is_active ? "active" : ""}`}>{d.is_active ? "Active" : "Archived"}</span></div>
            {d.description && <p className="muted">{d.description}</p>}
            <p>{d.active_employee_count} active employees <span className="muted">· {d.employee_count} assigned in total</span></p>
            <div className="actions"><button className="btn" disabled={busy} onClick={() => onViewEmployees(d.id)}>View employees<span className="sr-only"> in {d.name}</span></button><button className="btn" disabled={busy || !!archive || deleting !== null} onClick={() => { setEditing(d.id); setForm({ name: d.name, description: d.description, is_active: d.is_active }); setError(""); nameInput.current?.focus(); }}>Edit<span className="sr-only"> {d.name}</span></button><button className="btn" disabled={busy || !!archive || deleting !== null} onClick={() => d.is_active ? setArchive(d) : void changeStatus(d)}>{d.is_active ? "Archive" : "Restore"}<span className="sr-only"> {d.name}</span></button>{!d.is_active && <button className="btn danger" disabled={busy || !!archive || deleting !== null || d.employee_count > 0} onClick={() => { setDeleting(d.id); setDeleteError(""); }}>Delete<span className="sr-only"> {d.name}</span></button>}</div>
            {!d.is_active && <p className="muted department-delete-help">{d.employee_count ? "To delete, reassign or unassign all employees, including inactive employees." : "Archived and empty: this department can be permanently deleted."}</p>}
            {deleting === d.id && <div className="notice" role="alert"><p>Permanently delete {d.name}? This cannot be undone.</p>{deleteError && <p className="err">{deleteError}</p>}<div className="row"><button className="btn" disabled={busy} onClick={() => { setDeleting(null); setDeleteError(""); }}>Keep department</button><button className="btn danger" disabled={busy} onClick={() => void remove(d)}>{busy ? "Deleting..." : "Confirm delete"}</button></div></div>}
            {archive?.id === d.id && <div className="notice" role="alert"><p>Archive {d.name}? Its {d.employee_count} assigned employees keep this department. New assignments will be blocked until you restore it.</p><div className="row"><button className="btn" disabled={busy} onClick={() => setArchive(null)}>Keep active</button><button className="btn" disabled={busy} onClick={() => void changeStatus(d)}>Confirm archive</button></div></div>}
          </article>)}</div> : <p className="notice">{departments.length ? "No departments match these filters." : "No departments yet. Create your first department, then assign people on the Employees page."}</p>}
        </section>
      </div>
    </>}
  </div>;
}
