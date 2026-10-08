import type { OrgChartData } from "./api";

export const PORTRAIT_W = 156, PORTRAIT_H = 160, COMPANY_SIZE = 144;

/** Give each branch a separate angular sector; spread larger trees further out. */
export function radialPositions(data: OrgChartData, visible: Set<number>) {
  const children = new Map<number, number[]>();
  const managed = new Set<number>();
  for (const edge of data.edges) if (visible.has(edge.source) && visible.has(edge.target)) {
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
    managed.add(edge.target);
  }
  const roots = data.nodes.filter((e) => visible.has(e.id) && !managed.has(e.id));
  const weights = new Map<number, number>();
  function weigh(id: number): number {
    if (weights.has(id)) return weights.get(id)!;
    const value = Math.max(1, (children.get(id) ?? []).reduce((sum, child) => sum + weigh(child), 0));
    weights.set(id, value);
    return value;
  }
  roots.forEach((e) => weigh(e.id));
  const total = roots.reduce((sum, e) => sum + weigh(e.id), 0);
  const baseRadius = Math.max(230, roots.length * 200 / (2 * Math.PI));
  const ringGap = Math.max(200, total * 200 / (2 * Math.PI * 2));
  const positions = new Map<number, { x: number; y: number; depth: number }>();
  function place(id: number, depth: number, start: number, end: number) {
    const angle = (start + end) / 2;
    const radius = baseRadius + depth * ringGap;
    positions.set(id, { x: Math.cos(angle) * radius - PORTRAIT_W / 2, y: Math.sin(angle) * radius - 40, depth });
    const kids = children.get(id) ?? [];
    const sum = kids.reduce((n, child) => n + weigh(child), 0);
    let cursor = start;
    for (const child of kids) {
      const next = cursor + (end - start) * weigh(child) / sum;
      place(child, depth + 1, cursor, next);
      cursor = next;
    }
  }
  let cursor = -Math.PI * 1.5;
  for (const root of roots) {
    const end = cursor + 2 * Math.PI * weigh(root.id) / total;
    place(root.id, 0, cursor, end);
    cursor = end;
  }
  return { positions, roots };
}
