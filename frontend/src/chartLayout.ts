import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { OrgChartData } from "./api";
import { radialPositions, PORTRAIT_W, PORTRAIT_H, COMPANY_SIZE } from "./radialLayout";
export type LayoutMode = "radial" | "compact" | "tree";
const W = 240, H = 100, GAP = 48;
export const TREE_H = 76, GROUP_ID = -1;
const STACK_X = 24, STACK_TOP = 20, STEP = TREE_H + 10, COLS = 5;

/** People with no manager and no reports: shown in one "Not yet placed" group in tree mode. Board members are top-level on purpose. */
export const unplacedIds = (d: OrgChartData) => {
  const linked = new Set(d.edges.flatMap((e) => [e.source, e.target]));
  return d.edges.length ? d.nodes.filter((n) => !linked.has(n.id) && !n.is_board_member).map((n) => n.id) : [];
};

function addBoard(nodes: Node[], d: OrgChartData) {
  if (!d.board.length) return;
  const root = nodes[0];
  const bh = 44 + d.board.length * 68;
  nodes.push({
    id: "board", type: "board", draggable: false, selectable: false,
    position: { x: root?.position.x ?? 0, y: -bh - GAP },
    data: { members: d.board }, style: { width: W },
  });
}

/** Tree: leaf-only teams stack in one column under their manager; loose people sit in one grid below. */
function buildTree(d: OrgChartData, collapsed: Set<number>, visible: Set<number>, kidsOf: Map<number, number[]>) {
  const loose = new Set(unplacedIds(d));
  const isLeaf = (id: number) => !kidsOf.get(id)?.length;
  const vis = d.nodes.filter((n) => visible.has(n.id) && !loose.has(n.id));
  const stackOf = new Map<number, number[]>();
  vis.forEach((n) => { const k = kidsOf.get(n.id) ?? []; if (k.length && !collapsed.has(n.id) && k.every(isLeaf)) stackOf.set(n.id, k); });
  const stacked = new Set([...stackOf.values()].flat());
  const size = (id: number) => { const k = stackOf.get(id); return k ? { width: W + STACK_X, height: TREE_H + STACK_TOP + k.length * STEP } : { width: W, height: TREE_H }; };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  vis.filter((n) => !stacked.has(n.id)).forEach((n) => g.setNode(String(n.id), size(n.id)));
  const edges = d.edges.filter((e) => visible.has(e.source) && visible.has(e.target) && !loose.has(e.source));
  edges.filter((e) => !stacked.has(e.target)).forEach((e) => g.setEdge(String(e.source), String(e.target)));
  dagre.layout(g);

  const nodes: Node[] = [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  // Top-align each rank so a tall stacked team does not push its siblings down.
  const rankTop = new Map<number, number>();
  vis.filter((n) => !stacked.has(n.id)).forEach((n) => { const p = g.node(String(n.id)); rankTop.set(p.y, Math.min(rankTop.get(p.y) ?? Infinity, p.y - size(n.id).height / 2)); });
  vis.filter((n) => !stacked.has(n.id)).forEach((n) => {
    const p = g.node(String(n.id)), { width } = size(n.id);
    const x = p.x - width / 2, y = rankTop.get(p.y)!;
    nodes.push({ id: String(n.id), type: "emp", position: { x, y }, data: { e: n, kids: kidsOf.get(n.id)?.length ?? 0 } });
    stackOf.get(n.id)?.forEach((id, i) => nodes.push({ id: String(id), type: "emp", position: { x: x + STACK_X, y: y + TREE_H + STACK_TOP + i * STEP }, data: { e: byId.get(id)!, kids: 0, stacked: true } }));
  });
  const flowEdges: Edge[] = edges.map((e) => ({ id: `${e.source}-${e.target}`, source: String(e.source), target: String(e.target), type: stacked.has(e.target) ? "rail" : "smoothstep", style: { stroke: "#a6b8c9", strokeWidth: 1.5 } }));
  addBoard(nodes, d);

  if (loose.size) {
    const placed = nodes.filter((n) => n.id !== "board");
    const gx = placed.length ? Math.min(...placed.map((n) => n.position.x)) : 0;
    const gy = placed.length ? Math.max(...placed.map((n) => n.position.y + TREE_H)) + 70 : 0;
    const closed = collapsed.has(GROUP_ID);
    nodes.push({ id: "group", type: "group", draggable: false, selectable: false, position: { x: gx, y: gy }, style: { width: closed ? W : COLS * (W + 16) - 16 }, data: { label: `Not yet placed (${loose.size})`, closed } });
    if (!closed) d.nodes.filter((n) => loose.has(n.id)).forEach((n, i) => nodes.push({ id: String(n.id), type: "emp", position: { x: gx + (i % COLS) * (W + 16), y: gy + 56 + Math.floor(i / COLS) * (TREE_H + 14) }, data: { e: n, kids: 0, loose: true } }));
  }
  return { nodes, edges: flowEdges };
}


export function buildLayout(full: OrgChartData, collapsed: Set<number>, mode: LayoutMode) {
  // Board members with no manager appear only in the Board of Directors box.
  const mgr = new Set(full.edges.map((e) => e.target));
  const top = new Set(full.nodes.filter((n) => n.is_board_member && !mgr.has(n.id)).map((n) => n.id));
  const d = { ...full, nodes: full.nodes.filter((n) => !top.has(n.id)), edges: full.edges.filter((e) => !top.has(e.source)) };
  const compact = mode === "compact";
  const kidsOf = new Map<number, number[]>();
  d.edges.forEach((e) => kidsOf.set(e.source, [...(kidsOf.get(e.source) ?? []), e.target]));
  const hasMgr = new Set(d.edges.map((e) => e.target));
  // visible = reachable from roots without passing through a collapsed node
  const visible = new Set<number>();
  const walk = (id: number) => {
    if (visible.has(id)) return;
    visible.add(id);
    if (!collapsed.has(id)) kidsOf.get(id)?.forEach(walk);
  };
  d.nodes.filter((n) => !hasMgr.has(n.id)).forEach((n) => walk(n.id));

  if (mode === "radial") {
    const { positions, roots } = radialPositions(d, visible);
    const center = (id: number) => { const p = positions.get(id)!; return { x: p.x + PORTRAIT_W / 2, y: p.y + 40 }; };
    const nodes: Node[] = d.nodes.filter((e) => visible.has(e.id)).map((e) => ({ id: String(e.id), type: "portrait", position: positions.get(e.id)!, width: PORTRAIT_W, height: PORTRAIT_H, data: { e, kids: kidsOf.get(e.id)?.length ?? 0, depth: positions.get(e.id)!.depth } }));
    nodes.push({ id: "company", type: "company", position: { x: -COMPANY_SIZE / 2, y: -COMPANY_SIZE / 2 }, width: COMPANY_SIZE, height: COMPANY_SIZE, data: { company: d.company }, selectable: false });
    const edges: Edge[] = d.edges.filter((e) => visible.has(e.source) && visible.has(e.target)).map((e) => ({ id: `${e.source}-${e.target}`, source: String(e.source), target: String(e.target), type: "radial", data: { from: center(e.source), to: center(e.target) }, style: { stroke: "#a9b2bb", strokeWidth: 1 } }));
    roots.forEach((e) => edges.push({ id: `company-${e.id}`, source: "company", target: String(e.id), type: "radial", data: { from: { x: 0, y: 0 }, to: center(e.id), company: true }, style: { stroke: "#a9b2bb", strokeWidth: 1, strokeDasharray: "5 5" } }));
    return { nodes, edges };
  }

  if (mode === "tree") return buildTree(d, collapsed, visible, kidsOf);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  const vis = d.nodes.filter((n) => visible.has(n.id));
  vis.forEach((n) => g.setNode(String(n.id), { width: W, height: H }));
  const edges = d.edges.filter((e) => visible.has(e.source) && visible.has(e.target));
  edges.forEach((e) => g.setEdge(String(e.source), String(e.target)));
  dagre.layout(g);

  const nodes: Node[] = vis.map((n) => {
    const p = g.node(String(n.id));
    return { id: String(n.id), type: "emp", position: { x: p.x - W / 2, y: p.y - H / 2 }, data: { e: n, kids: kidsOf.get(n.id)?.length ?? 0 } };
  });
  if (compact) {
    let row = 0;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const place = (id: number, depth: number) => {
      const node = byId.get(String(id));
      if (!node) return;
      node.position = { x: depth * 40, y: row++ * (H + 32) };
      if (!collapsed.has(id)) kidsOf.get(id)?.forEach((kid) => place(kid, depth + 1));
    };
    d.nodes.filter((n) => !hasMgr.has(n.id)).forEach((n) => place(n.id, 0));
  }
  addBoard(nodes, d);
  const flowEdges: Edge[] = edges.map((e) => ({ id: `${e.source}-${e.target}`, source: String(e.source), target: String(e.target), type: compact ? "compact" : "smoothstep", style: { stroke: "#a6b8c9", strokeWidth: 1.5 } }));
  return { nodes, edges: flowEdges };
}

