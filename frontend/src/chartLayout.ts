import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { OrgChartData } from "./api";
import { radialPositions, PORTRAIT_W, PORTRAIT_H, COMPANY_SIZE } from "./radialLayout";
export type LayoutMode = "radial" | "compact" | "tree";
const W = 240, H = 100, GAP = 48;

export function buildLayout(d: OrgChartData, collapsed: Set<number>, mode: LayoutMode) {
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
  if (d.board.length) {
    const root = nodes[0];
    const bw = W;
    const bh = 44 + d.board.length * 68;
    nodes.push({
      id: "board", type: "board", draggable: false, selectable: false,
      position: { x: root?.position.x ?? 0, y: -bh - GAP },
      data: { members: d.board }, style: { width: bw },
    });
  }
  const flowEdges: Edge[] = edges.map((e) => ({ id: `${e.source}-${e.target}`, source: String(e.source), target: String(e.target), type: compact ? "compact" : "smoothstep", style: { stroke: "#a6b8c9", strokeWidth: 1.5 } }));
  return { nodes, edges: flowEdges };
}

