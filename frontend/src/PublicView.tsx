import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { AnimatePresence, MotionConfig, animate, motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, imgUrl, type Employee, type OrgChartData, type PublicCompany } from "./api";
import { buildLayout, GROUP_ID, TREE_H, unplacedIds } from "./chartLayout";
import { edgeTypes } from "./OrgChart";
import { PORTRAIT_W } from "./radialLayout";

type Person = Employee;
type View = "radial" | "tree" | "grid";
const VIEWS: { id: View; label: string }[] = [{ id: "radial", label: "Radial" }, { id: "tree", label: "Tree" }, { id: "grid", label: "Grid" }];
const NODE_W = 240;
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const deptColor = (name: string | null) => (name ? `hsl(${hue(name)} 62% 36%)` : "#526479");
const accent = (name: string | null) => (name ? deptColor(name) : "#3b7bc9");
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function Photo({ p, size }: { p: Pick<Person, "name" | "photo_path">; size: number }) {
  const src = imgUrl(p.photo_path);
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return <span className="pv-photo" style={{ width: size, height: size }}>
    {src && !bad
      ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setBad(true)} />
      : <span className="pv-initials" style={{ fontSize: size / 2.6, background: `linear-gradient(135deg, hsl(${hue(p.name)} 70% 55%), hsl(${(hue(p.name) + 40) % 360} 70% 38%))` }}>{initials(p.name)}</span>}
  </span>;
}

function DeptChip({ name }: { name: string | null }) {
  return name ? <span className="pv-chip" style={{ background: deptColor(name) }}>{name}</span> : null;
}

function CountUp({ to }: { to: number }) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) { setV(to); return; }
    const c = animate(0, to, { duration: 1.1, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [to, reduce]);
  return <>{v}</>;
}

/* ---------- chart nodes ---------- */
type FlowCtx = { select: (id: number) => void; toggle: (id: number) => void; selected: number | null; collapsed: Set<number> };
const Ctx = createContext<FlowCtx>(null!);

function PortraitNode({ data }: NodeProps<Node<{ e: Person; kids: number; depth: number }>>) {
  const { select, toggle, selected, collapsed } = useContext(Ctx);
  const { e, kids, depth } = data;
  return <div className={`pv-portrait tier-${Math.min(depth, 2)}${selected === e.id ? " sel" : ""}`}>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
    <button className="pv-portrait-btn" aria-label={`View ${e.name}, ${e.designation || "team member"}`} onClick={() => select(e.id)}>
      <Photo p={e} size={80} />
      <span className="pv-portrait-label"><b title={e.name}>{e.name}</b><span title={e.designation}>{e.designation || "Team member"}</span></span>
    </button>
    {kids > 0 && <button className="pv-toggle" aria-expanded={!collapsed.has(e.id)} aria-label={`${collapsed.has(e.id) ? "Expand" : "Collapse"} ${e.name}'s ${kids} direct reports`} onClick={() => toggle(e.id)}>{collapsed.has(e.id) ? "+" : "−"} {kids}</button>}
  </div>;
}

function CardNode({ data }: NodeProps<Node<{ e: Person; kids: number }>>) {
  const { select, toggle, selected, collapsed } = useContext(Ctx);
  const { e, kids } = data;
  return <div className={`pv-card-node${selected === e.id ? " sel" : ""}`}>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <button className="pv-card-btn" aria-label={`View ${e.name}, ${e.designation || "team member"}`} onClick={() => select(e.id)}>
      <Photo p={e} size={46} />
      <span className="pv-card-text"><b title={e.name}>{e.name}</b><span title={e.designation}>{e.designation || "Team member"}</span></span>
    </button>
    {kids > 0 && <button className="pv-toggle" aria-expanded={!collapsed.has(e.id)} aria-label={`${collapsed.has(e.id) ? "Expand" : "Collapse"} ${e.name}'s ${kids} direct reports`} onClick={() => toggle(e.id)}>{collapsed.has(e.id) ? "+" : "−"} {kids}</button>}
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </div>;
}

function BoardNode({ data }: NodeProps<Node<{ members: Person[] }>>) {
  const { select, selected } = useContext(Ctx);
  return <div className="pv-board">
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
    <div className="pv-board-title">Board of Directors</div>
    {data.members.map((m) => <button key={m.id} className={"pv-board-member" + (selected === m.id ? " sel" : "")} onClick={() => select(m.id)} aria-label={`View ${m.name}, ${m.designation}`}>
      <Photo p={m} size={36} /><span><b>{m.name}</b><span>{m.designation}</span></span>
    </button>)}
  </div>;
}

function CompanyNode({ data }: NodeProps<Node<{ company: OrgChartData["company"] }>>) {
  const [failed, setFailed] = useState(false);
  return <div className="pv-company">
    <Handle type="source" position={Position.Top} isConnectable={false} />
    {data.company.logo_path && !failed ? <img src={imgUrl(data.company.logo_path)} alt={data.company.company_name} onError={() => setFailed(true)} /> : <b>{data.company.company_name}</b>}
  </div>;
}

function GroupNode({ data }: NodeProps<Node<{ label: string; closed: boolean }>>) {
  const { toggle } = useContext(Ctx);
  return <button className="pv-group" aria-expanded={!data.closed} onClick={() => toggle(GROUP_ID)}><b>{data.label}</b><span>{data.closed ? "+ Show" : "− Hide"}</span></button>;
}

const nodeTypes = { portrait: PortraitNode, emp: CardNode, board: BoardNode, company: CompanyNode, group: GroupNode };

function initialCollapsed(data: OrgChartData, loose: Set<number>, parent: Map<number, number>) {
  if (data.nodes.length <= 20) return new Set<number>();
  const depth = (id: number) => { let n = 0; const seen = new Set<number>(); for (let p = parent.get(id); p !== undefined && !seen.has(p); p = parent.get(p)) { seen.add(p); n++; } return n; };
  const next = new Set(data.edges.map((e) => e.source).filter((id) => depth(id) >= 2));
  if (loose.size > 8) next.add(GROUP_ID);
  return next;
}

function FlowView({ data, mode, selected, onSelect }: { data: OrgChartData; mode: "radial" | "tree"; selected: number | null; onSelect: (id: number) => void }) {
  const reduce = useReducedMotion();
  const loose = useMemo(() => new Set(unplacedIds(data)), [data]);
  const parent = useMemo(() => new Map(data.edges.map((e) => [e.target, e.source])), [data]);
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(data, loose, parent));
  const layout = useMemo(() => buildLayout(data, collapsed, mode), [data, collapsed, mode]);
  const { setCenter } = useReactFlow();
  const toggle = (id: number) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(id)) n.add(id); return n; });

  // Selecting someone opens any collapsed branch above them, then glides the view to them.
  useEffect(() => {
    if (selected === null) return;
    const next = new Set(collapsed);
    let changed = false;
    for (let p = parent.get(selected), seen = new Set<number>(); p !== undefined && !seen.has(p); p = parent.get(p)) { seen.add(p); if (next.delete(p)) changed = true; }
    if (loose.has(selected) && next.delete(GROUP_ID)) changed = true;
    if (changed) { setCollapsed(next); return; }
    const n = layout.nodes.find((x) => x.id === String(selected)) ?? layout.nodes.find((x) => x.id === "board");
    if (n) setCenter(n.position.x + (mode === "radial" ? PORTRAIT_W / 2 : NODE_W / 2), n.position.y + (mode === "radial" ? 40 : TREE_H / 2), { zoom: 1, duration: reduce ? 0 : 600 });
  }, [selected, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ select: onSelect, toggle, selected, collapsed }}>
    <div className="pv-flow">
      <ReactFlow nodes={layout.nodes} edges={layout.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={0.1} maxZoom={2}
        fitView fitViewOptions={{ padding: 0.15, minZoom: 0.1, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        {mode === "tree" && <Background gap={28} size={1.2} color="#c9d8ea" />}
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="pv-hint" aria-hidden="true">Drag to explore · Scroll to zoom · Select a person</div>
      <div className="pv-flow-tools">
        <button className="pv-pill" onClick={() => setCollapsed(new Set())}>Expand all</button>
        <button className="pv-pill" onClick={() => setCollapsed(new Set([...data.edges.map((e) => e.source), ...(loose.size ? [GROUP_ID] : [])]))}>Collapse all</button>
      </div>
    </div>
  </Ctx.Provider>;
}

/* ---------- grid ---------- */
function PersonCard({ p, i, featured, onSelect }: { p: Person; i: number; featured?: boolean; onSelect: (id: number) => void }) {
  const color = accent(p.department_name);
  return <motion.button layout className={"pv-person" + (featured ? " featured" : "")} style={{ ["--accent" as string]: color }}
    initial={{ opacity: 0, y: 20, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: Math.min(i, 24) * 0.03, type: "spring", stiffness: 260, damping: 24 } }}
    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
    whileHover={{ y: -6 }} whileTap={{ scale: 0.98 }} onClick={() => onSelect(p.id)}
    aria-label={`View ${p.name}, ${p.designation || "team member"}`}>
    <span className="pv-person-banner" />
    <Photo p={p} size={featured ? 104 : 88} />
    <b>{p.name}</b>
    <span className="pv-role">{p.designation || "Team member"}</span>
    <DeptChip name={p.department_name} />
  </motion.button>;
}

function GridView({ people, board, query, onSelect }: { people: Person[]; board: Person[]; query: string; onSelect: (id: number) => void }) {
  const [dept, setDept] = useState("");
  const departments = useMemo(() => [...new Set(people.map((p) => p.department_name).filter((d): d is string => Boolean(d)))].sort(), [people]);
  const q = query.trim().toLowerCase();
  const filtering = Boolean(q || dept);
  const match = (p: Person) => (!dept || p.department_name === dept) && (!q || `${p.name} ${p.designation} ${p.department_name ?? ""}`.toLowerCase().includes(q));
  const boardIds = new Set(board.map((b) => b.id));
  const featured = !filtering && board.length > 0;
  const list = people.filter((p) => match(p) && !(featured && boardIds.has(p.id)));
  return <div className="pv-grid-wrap">
    <div className="pv-chips" role="group" aria-label="Filter by department">
      <button className={"pv-filter" + (!dept ? " on" : "")} aria-pressed={!dept} onClick={() => setDept("")}>Everyone <span>{people.length}</span></button>
      {departments.map((d) => <button key={d} className={"pv-filter" + (dept === d ? " on" : "")} aria-pressed={dept === d} onClick={() => setDept(dept === d ? "" : d)}>{d} <span>{people.filter((p) => p.department_name === d).length}</span></button>)}
    </div>
    {featured && <section aria-label="Board of Directors"><h2 className="pv-section">Board of Directors</h2><div className="pv-grid featured-row">{board.map((p, i) => <PersonCard key={p.id} p={p} i={i} featured onSelect={onSelect} />)}</div></section>}
    <h2 className="pv-section">{filtering ? `${list.length} ${list.length === 1 ? "person" : "people"}` : "Our team"}</h2>
    <motion.div layout className="pv-grid">
      <AnimatePresence mode="popLayout">{list.map((p, i) => <PersonCard key={p.id} p={p} i={i} onSelect={onSelect} />)}</AnimatePresence>
    </motion.div>
    {!list.length && <p className="pv-empty" role="status">No one matches. Try a different search or department.</p>}
  </div>;
}

/* ---------- details drawer ---------- */
function Drawer({ id, people, onSelect, onClose }: { id: number; people: Person[]; onSelect: (id: number) => void; onClose: () => void }) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const p = byId.get(id);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  if (!p) return null;
  const manager = p.reports_to_id ? byId.get(p.reports_to_id) : undefined;
  const reports = people.filter((x) => x.reports_to_id === p.id);
  const chain: Person[] = [];
  for (let m = manager, seen = new Set<number>(); m && !seen.has(m.id); m = m.reports_to_id ? byId.get(m.reports_to_id) : undefined) { seen.add(m.id); chain.push(m); }
  const link = (x: Person) => <button key={x.id} className="pv-link" onClick={() => onSelect(x.id)}><Photo p={x} size={34} /><span><b>{x.name}</b><small>{x.designation}</small></span></button>;
  return <>
    <motion.div className="pv-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
    <motion.aside className="pv-drawer" role="dialog" aria-label={`${p.name} details`} initial={{ x: 48, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 48, opacity: 0, transition: { duration: 0.15 } }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
      <button className="pv-close" aria-label="Close details" onClick={onClose} autoFocus>×</button>
      <div className="pv-drawer-head" style={{ ["--accent" as string]: accent(p.department_name) }}>
        <motion.div key={p.id} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}><Photo p={p} size={132} /></motion.div>
        <h2>{p.name}</h2>
        <p>{p.designation || "Team member"}</p>
        <div className="pv-chips-inline"><DeptChip name={p.department_name} />{p.is_board_member && <span className="pv-chip board">Board member</span>}</div>
      </div>
      {manager && <section><h3>Reports to</h3>{link(manager)}</section>}
      {reports.length > 0 && <section><h3>Direct reports · {reports.length}</h3><div className="pv-links">{reports.map(link)}</div></section>}
      {chain.length > 1 && <section><h3>Reporting chain</h3><p className="pv-chain">{chain.map((c, i) => <span key={c.id}>{i > 0 && " › "}<button className="pv-inline" onClick={() => onSelect(c.id)}>{c.name}</button></span>)}</p></section>}
    </motion.aside>
  </>;
}

/* ---------- page ---------- */
export default function PublicView() {
  const [companies, setCompanies] = useState<PublicCompany[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(() => Number(new URLSearchParams(location.search).get("c")) || null);
  const [data, setData] = useState<OrgChartData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>("radial");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setError(""); setData(null); setSelected(null);
    (async () => {
      try {
        const list = await api.publicCompanies();
        if (!live) return;
        setCompanies(list);
        const id = list.some((c) => c.id === companyId) ? companyId! : list[0]?.id;
        if (id === undefined) { setError("No company has been set up yet."); return; }
        if (id !== companyId) { setCompanyId(id); return; }
        const chart = await api.publicChart(id);
        if (live) { setData(chart); document.title = `${chart.company.company_name} · Our team`; }
      } catch (e) { if (live) setError(message(e)); }
    })();
    return () => { live = false; };
  }, [companyId, attempt]);

  const people = useMemo(() => (data ? [...new Map([...data.board, ...data.nodes].map((p) => [p.id, p])).values()] : []), [data]);
  const departments = useMemo(() => new Set(people.map((p) => p.department_name).filter(Boolean)).size, [people]);
  const matches = view !== "grid" && query.trim() ? people.filter((p) => `${p.name} ${p.designation}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6) : [];
  const pick = (id: number) => { setSelected(id); setQuery(view === "grid" ? query : ""); };
  const company = companies.find((c) => c.id === companyId);

  return <MotionConfig reducedMotion="user"><div className="pv">
    <div className="pv-bg" aria-hidden="true"><i /><i /><i /></div>
    <header className="pv-header glass3d">
      <div className="pv-brand">
        {company?.logo_path && <img src={imgUrl(company.logo_path)} alt="" />}
        <h1 className="sr-only">{company?.company_name ?? "Our team"}</h1>
        {companies.length > 0 && <label className="company-switch"><span className="sr-only">Company</span><select value={companyId ?? ""} onChange={(e) => { setCompanyId(Number(e.target.value)); history.replaceState(null, "", `?c=${e.target.value}`); }}>{companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>}
      </div>
      <div className="pv-search">
        <input aria-label="Find a person" placeholder={view === "grid" ? "Search by name, role or department" : "Find a person or role"} value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); if (e.key === "Enter" && matches[0]) pick(matches[0].id); }} />
        {matches.length > 0 && <div className="pv-results" role="listbox">{matches.map((m) => <button key={m.id} role="option" aria-selected={false} onClick={() => pick(m.id)}><Photo p={m} size={30} /><span><b>{m.name}</b><small>{m.designation}</small></span></button>)}</div>}
        {view !== "grid" && query.trim() && !matches.length && <div className="pv-results"><p>No people found</p></div>}
      </div>
      <div className="pv-toggle-group" role="group" aria-label="View">
        {VIEWS.map((v) => <button key={v.id} className={view === v.id ? "on" : ""} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
          {view === v.id && <motion.span layoutId="pv-pill" className="pv-pill-bg" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
          <span>{v.label}</span>
        </button>)}
      </div>
    </header>

    {data && <motion.div className="pv-stats" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <span><b><CountUp to={people.length} /></b> people</span>{departments > 0 && <span><b><CountUp to={departments} /></b> departments</span>}{data.board.length > 0 && <span><b><CountUp to={data.board.length} /></b> directors</span>}
    </motion.div>}

    <main className={"pv-stage" + (view === "grid" ? " scroll" : "")}>
      {error ? <div className="pv-state" role="alert"><p>{error}</p><button className="pv-pill" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>
        : !data ? <div className="pv-state" role="status"><div className="pv-skeleton" /><p>Loading the team…</p></div>
        : !people.length ? <div className="pv-state"><p>No one has been added yet.</p></div>
        : <motion.div key={view + companyId} className="pv-view" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: "easeOut" }}>
            {view === "grid"
              ? <GridView people={people} board={data.board} query={query} onSelect={pick} />
              : <ReactFlowProvider><FlowView data={data} mode={view} selected={selected} onSelect={pick} /></ReactFlowProvider>}
          </motion.div>}
    </main>
    <footer className="pv-footer"><a href="/admin">Admin</a></footer>
    <AnimatePresence>{selected !== null && data && <Drawer key="drawer" id={selected} people={people} onSelect={setSelected} onClose={() => setSelected(null)} />}</AnimatePresence>
  </div></MotionConfig>;
}
