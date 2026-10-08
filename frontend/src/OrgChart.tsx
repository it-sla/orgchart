import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, imgUrl, type Employee, type OrgChartData } from "./api";
import { PORTRAIT_W, PORTRAIT_H, COMPANY_SIZE } from "./radialLayout";
import { buildLayout, GROUP_ID, TREE_H, unplacedIds, type LayoutMode } from "./chartLayout";

const W = 240, H = 100;

export function Avatar({ e, size = 44 }: { e: { name: string; photo_path: string | null }; size?: number }) {
  const src = imgUrl(e.photo_path);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img className="avatar" src={src} width={size} height={size} alt="" onError={() => setFailed(true)} />
  ) : (
    <span className="avatar ph" style={{ width: size, height: size, fontSize: size / 2.5 }}>
      {e.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
    </span>
  );
}


type Ctx = { select: (id: number) => void; toggle: (id: number) => void; selected: number | null; collapsed: Set<number>; compact: boolean; tree: boolean };
const ChartCtx = createContext<Ctx>(null!);

function EmpNode({ data }: NodeProps<Node<{ e: Employee; kids: number }>>) {
  const { select, toggle, selected, collapsed, compact, tree } = useContext(ChartCtx);
  const { e, kids } = data;
  return (
    <div className={"emp-node" + (tree ? " tree" : "") + (selected === e.id ? " sel" : "")} >
      <button className="node-select" aria-label={`View ${e.name}, ${e.designation}`} onClick={() => select(e.id)} />
      <Handle type="target" position={compact ? Position.Left : Position.Top} isConnectable={false} />
      <Avatar e={e} />
      <div className="txt">
        <b>{e.name}</b>
        <span title={e.designation}>{e.designation || "Team member"}</span>
      </div>
      {kids > 0 && (
        <button
          className="tog"
          aria-expanded={!collapsed.has(e.id)}
          aria-label={`${collapsed.has(e.id) ? "Expand" : "Collapse"} ${e.name}'s ${kids} direct reports`}
          title={collapsed.has(e.id) ? "Expand branch" : "Collapse branch"}
          onClick={(ev) => { ev.stopPropagation(); toggle(e.id); }}
        >
          {collapsed.has(e.id) ? "+" : "-"} <span>{kids} reports</span>
        </button>
      )}
      <Handle type="source" position={compact ? Position.Left : Position.Bottom} isConnectable={false} />
    </div>
  );
}

function GroupNode({ data }: NodeProps<Node<{ label: string; closed: boolean }>>) {
  const { toggle } = useContext(ChartCtx);
  return <button className="group-node" aria-expanded={!data.closed} onClick={() => toggle(GROUP_ID)}>
    <b>{data.label}</b><span>{data.closed ? "+ Show" : "- Hide"}</span>
  </button>;
}

function BoardNode({ data }: NodeProps<Node<{ members: Employee[] }>>) {
  const { select, selected } = useContext(ChartCtx);
  return (
    <div className="board-node">
      <div className="board-title">Board of Directors</div>
      <div className="board-members">
        {data.members.map((m) => (
          <button key={m.id} className={"bm" + (selected === m.id ? " sel" : "")} onClick={() => select(m.id)}>
            <Avatar e={m} size={32} />
            <div><b>{m.name}</b><span>{m.designation}</span></div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PortraitNode({ data }: NodeProps<Node<{ e: Employee; kids: number; depth: number }>>) {
  const { select, toggle, selected, collapsed } = useContext(ChartCtx);
  const { e, kids, depth } = data;
  return <div className={`portrait-node tier-${Math.min(depth, 2)}${selected === e.id ? " sel" : ""}`}>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
    <button className="portrait-select" aria-label={`View ${e.name}, ${e.designation}`} onClick={() => select(e.id)}>
      <Avatar e={e} size={80} />
      <div className="portrait-label"><b title={e.name}>{e.name}</b><span title={e.designation}>{e.designation || "Team member"}</span></div>
    </button>
    {e.is_board_member && <span className="board-badge">Board member</span>}
    {kids > 0 && <button className="portrait-toggle" aria-expanded={!collapsed.has(e.id)} aria-label={`${collapsed.has(e.id) ? "Expand" : "Collapse"} ${e.name}'s ${kids} direct reports`} onClick={() => toggle(e.id)}>{collapsed.has(e.id) ? "+" : "-"} {kids}</button>}
  </div>;
}

function CompanyNode({ data }: NodeProps<Node<{ company: OrgChartData["company"] }>>) {
  const [failed, setFailed] = useState(false);
  return <div className="company-node">
    <Handle type="source" position={Position.Top} isConnectable={false} />
    {data.company.logo_path && !failed ? <img src={imgUrl(data.company.logo_path)} alt={data.company.company_name} onError={() => setFailed(true)} /> : <b>{data.company.company_name}</b>}
    <span>Our organization</span>
  </div>;
}

const nodeTypes = { emp: EmpNode, group: GroupNode, board: BoardNode, portrait: PortraitNode, company: CompanyNode };

function CompactEdge(props: EdgeProps) {
  const rail = props.sourceX - 24;
  return <BaseEdge {...props} path={`M ${props.sourceX},${props.sourceY} H ${rail} V ${props.targetY} H ${props.targetX}`} />;
}
// Stacked team: a rail down the left of the column with a stub into each card.
function RailEdge(props: EdgeProps) {
  return <BaseEdge {...props} path={`M ${props.sourceX - W / 2 + 12},${props.sourceY} V ${props.targetY + TREE_H / 2} H ${props.targetX - W / 2}`} />;
}
function RadialEdge(props: EdgeProps) {
  const d = props.data as { from: { x: number; y: number }; to: { x: number; y: number }; company?: boolean };
  const dx = d.to.x - d.from.x, dy = d.to.y - d.from.y;
  const length = Math.hypot(dx, dy) || 1;
  const start = d.company ? COMPANY_SIZE / 2 : 42, end = 42;
  return <BaseEdge id={props.id} style={props.style} path={`M ${d.from.x + dx / length * start},${d.from.y + dy / length * start} L ${d.to.x - dx / length * end},${d.to.y - dy / length * end}`} />;
}
const edgeTypes = { compact: CompactEdge, radial: RadialEdge, rail: RailEdge };


function Panel({ id, select, onClose }: { id: number; select: (id: number) => void; onClose: () => void }) {
  const [info, setInfo] = useState<{ e: Employee; mgr: Employee | null; reports: Employee[]; chain: Employee[] } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setInfo(null);
    Promise.all([api.employee(id), api.manager(id), api.reports(id), api.chain(id)]).then(([e, mgr, reports, chain]) =>
      active && setInfo({ e, mgr, reports, chain }),
    ).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not load person details."); });
    return () => { active = false; };
  }, [id, attempt]);
  if (!info) return <aside className="panel"><button aria-label="Close person details" className="x" onClick={onClose}>X</button>{error ? <div role="alert"><p>{error}</p><button className="btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div> : <p role="status">Loading person details...</p>}</aside>;
  const link = (p: Employee) => <button className="person-link" key={p.id} onClick={() => select(p.id)}>{p.name}<small> {p.designation}</small></button>;
  return (
    <aside className="panel">
      <button aria-label="Close person details" className="x" onClick={onClose}>×</button>
      <Avatar e={info.e} size={96} />
      <h2>{info.e.name}</h2>
      <p className="muted">{info.e.designation}</p>
      <h4>Department</h4>
      <p>{info.e.department_name || "Unassigned"}</p>
      <h4>Reports To</h4>
      {info.mgr ? link(info.mgr) : <p className="muted">—</p>}
      <h4>Direct Reports</h4>
      {info.reports.length ? info.reports.map(link) : <p className="muted">None</p>}
      {info.chain.length > 1 && (
        <>
          <h4>Reporting Chain</h4>
          <p className="chain">{info.chain.map((p, i) => <span key={p.id}>{i > 0 && " / "}<button className="person-link" onClick={() => select(p.id)}>{p.name}</button></span>)}</p>
        </>
      )}
    </aside>
  );
}

function Chart({ data }: { data: OrgChartData }) {
  // Start with leaders and their direct teams; deeper branches open on demand.
  const loose = useMemo(() => new Set(unplacedIds(data)), [data]);
  const collapseAll = () => new Set([...data.edges.map((e) => e.source), ...(loose.size ? [GROUP_ID] : [])]);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    if (data.nodes.length <= 20) return new Set();
    const closedGroup = loose.size > 8 ? [GROUP_ID] : [];
    const parent = new Map(data.edges.map((e) => [e.target, e.source]));
    const depth = (id: number) => { let level = 0; const seen = new Set<number>(); for (let p = parent.get(id); p !== undefined && !seen.has(p); p = parent.get(p)) { seen.add(p); level++; } return level; };
    return new Set([...[...collapseAll()].filter((id) => id !== GROUP_ID && depth(id) >= 2), ...closedGroup]);
  });
  const [mode, setMode] = useState<LayoutMode>("radial");
  const compact = mode === "compact";
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [scope, setScope] = useState<"full" | "visible">("full");
  const [paper, setPaper] = useState("chart");
  const [orientation, setOrientation] = useState("portrait");
  const [exportError, setExportError] = useState("");
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => { if (download) return () => URL.revokeObjectURL(download.url); }, [download]);
  useEffect(() => { setDownload(null); setExportError(""); }, [mode, scope, paper, orientation]);
  const [selected, setSelected] = useState<number | null>(null);
  const { setCenter, setViewport, fitView } = useReactFlow();
  const layout = useMemo(() => buildLayout(data, collapsed, mode), [data, collapsed, mode]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const people = useMemo(() => [...new Map([...data.board, ...data.nodes].map((e) => [e.id, e])).values()], [data]);
  const matches = query.trim() ? people.filter((e) => `${e.name} ${e.designation}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];
  useEffect(() => {
    if (mode !== "compact") {
      const narrow = (document.querySelector(".chart-wrap")?.clientWidth ?? window.innerWidth) < 700;
      void fitView({ nodes: layoutRef.current.nodes, padding: .15, minZoom: mode === "radial" && narrow ? .65 : .1, maxZoom: 1 });
      return;
    }
    const board = layoutRef.current.nodes.find((n) => n.id === "board");
    const root = layoutRef.current.nodes[0];
    const top = board ?? root;
    if (top) setViewport({ x: 36 - top.position.x * .9, y: 28 - top.position.y * .9, zoom: .9 });
  }, [mode, setViewport, fitView]);

  const select = (id: number) => {
    // expand any collapsed ancestors so the node is visible
    const parent = new Map(data.edges.map((e) => [e.target, e.source]));
    const next = new Set(collapsed);
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) next.delete(p);
    if (loose.has(id)) next.delete(GROUP_ID);
    setCollapsed(next);
    setSelected(id);
    setQuery("");
  };
  const toggle = (id: number) =>
    setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    const n = layoutRef.current.nodes.find((x) => x.id === String(selected)) ?? layoutRef.current.nodes.find((x) => x.id === "board");
    if (selected !== null && n) setCenter(n.position.x + (mode === "radial" ? PORTRAIT_W / 2 : W / 2), n.position.y + (mode === "radial" ? PORTRAIT_H / 2 : H / 2), { zoom: 1, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250 });
  }, [selected, layout, setCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportPdf = async () => {
    if (exportLock.current) return;
    exportLock.current = true; setExporting(true); setExportError("");
    try {
      const exportLayout = scope === "full" ? buildLayout(data, new Set(), mode) : layout;
      const ids = exportLayout.nodes.filter((n) => n.type === "emp" || n.type === "portrait").map((n) => Number(n.id));
      const positions = exportLayout.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, depth: Number(n.data.depth ?? 0), stacked: Boolean(n.data.stacked), label: String(n.data.label ?? "") }));
      const blob = await api.exportPdf({ scope, ids, paper, orientation, layout: mode, positions });
      const url = URL.createObjectURL(blob);
      const name = `${data.company.company_name.replace(/[\\/:*?"<>|]/g, "-")} - ${mode} - ${scope === "full" ? "Full organization" : "Current view"}.pdf`;
      setDownload({ url, name });
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    } catch (e) { setExportError(e instanceof Error ? e.message : "Export failed. Please try again."); }
    finally { exportLock.current = false; setExporting(false); }
  };

  return (
    <ChartCtx.Provider value={{ select, toggle, selected, collapsed, compact, tree: mode === "tree" }}>
      <div className={`chart-page ${mode === "radial" ? "radial-chart" : ""}`}>
        <div className="chart-toolbar">
          <div className="chart-heading"><h1>Organization chart</h1><p>{people.length} people | Select a person to see their reporting relationships</p></div>
          <div className="chart-actions">
            <details className="export-options"><summary className="btn primary">Export PDF</summary><div className="export-menu">
              <label>Include<select value={scope} onChange={(e) => setScope(e.target.value as "full" | "visible")} disabled={exporting}><option value="full">Full organization ({data.nodes.length} people)</option><option value="visible">Currently displayed people ({layout.nodes.filter((n) => n.type === "emp" || n.type === "portrait").length})</option></select></label>
              <p><b>{mode[0].toUpperCase() + mode.slice(1)} layout</b> · Matches the selected chart style</p>
              <label>Page size<select value={paper} onChange={(e) => setPaper(e.target.value)} disabled={exporting}><option value="chart">Chart size (readable at 100%)</option><option value="a4">Fit to A4</option><option value="letter">Fit to Letter</option></select></label>
              {paper !== "chart" && <label>Orientation<select value={orientation} onChange={(e) => setOrientation(e.target.value)} disabled={exporting}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>}
              <p className="muted">Preserves portraits, cards and reporting lines. Full organization includes collapsed teams.{paper !== "chart" && " Large charts shrink to fit one page; choose Chart size for readable labels."}</p>
              <button className="btn primary" disabled={exporting} onClick={() => void exportPdf()}>{exporting ? "Preparing PDF..." : "Download PDF"}</button>
              {exportError && <p className="err" role="alert">{exportError}</p>}
              {download && <p role="status">PDF ready. <a href={download.url} download={download.name}>Download again</a></p>}
            </div></details>
          </div>
          <div className="chart-tools">
            <div className="people-search">
              <input aria-label="Find a person" placeholder="Find a person or role..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
              {query.trim() && <div className="search-results">{matches.length ? matches.map((e) => <button key={e.id} onClick={() => select(e.id)}><b>{e.name}</b><span>{e.designation}</span></button>) : <p>No people found</p>}</div>}
            </div>
            <div className="layout-switch" aria-label="Chart layout"><button disabled={exporting} aria-pressed={mode === "radial"} onClick={() => setMode("radial")}>Radial</button><button disabled={exporting} aria-pressed={compact} onClick={() => setMode("compact")}>Compact</button><button disabled={exporting} aria-pressed={mode === "tree"} onClick={() => setMode("tree")}>Tree</button></div>
            <button className="btn" onClick={() => setCollapsed(new Set())}>Expand all</button>
            <button className="btn" onClick={() => setCollapsed(collapseAll())}>Collapse all</button>
            <button className="btn" onClick={() => fitView({ padding: .15, duration: 250 })}>Fit chart</button>
          </div>
        </div>
      <div className="chart-wrap">
        <ReactFlow
          nodes={layout.nodes} edges={layout.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          minZoom={0.1} maxZoom={2}
          nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}
        >
          {mode !== "radial" && <Background gap={24} size={1} color="#dce4eb" />}
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="chart-hint">Drag to explore | Use + to open a team</div>
        {mode === "radial" && <div className="radial-legend"><span />Reporting line <i />Company connection</div>}
        {selected !== null && <Panel id={selected} select={select} onClose={() => setSelected(null)} />}
      </div>
      </div>
    </ChartCtx.Provider>
  );
}

export default function OrgChart() {
  const [data, setData] = useState<OrgChartData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setError(""); setData(null);
    api.orgChart().then((d) => { if (active) setData(d); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not load the chart."); });
    return () => { active = false; };
  }, [attempt]);
  if (error) return <div className="pad notice error" role="alert"><p>{error}</p><button className="btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>;
  if (!data) return <p className="muted pad" role="status">Loading organization chart...</p>;
  if (!data.nodes.length && !data.board.length) return <p className="muted pad">No employees yet. Add your first person on the Employees page.</p>;
  return <ReactFlowProvider><Chart data={data} /></ReactFlowProvider>;
}
