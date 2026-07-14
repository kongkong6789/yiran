/** 在关系图上查找简单闭环(无向),用于图谱分批展示。 */
export type GraphLoop = {
  nodeIds: number[];
  relationIds: number[];
};

type Rel = { id: number; source: number; target: number };

function buildAdjacency(relations: Rel[]) {
  const adj = new Map<number, number[]>();
  const touch = (from: number, to: number) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  };
  for (const r of relations) {
    touch(r.source, r.target);
    touch(r.target, r.source);
  }
  return adj;
}

export function findSimpleLoops(
  relations: Rel[],
  options?: { maxLen?: number; maxLoops?: number },
): GraphLoop[] {
  const maxLen = options?.maxLen ?? 6;
  const maxLoops = options?.maxLoops ?? 100;
  if (relations.length < 3) return [];

  const adj = new Map<number, Array<{ to: number; rel: number }>>();
  const addEdge = (from: number, to: number, rel: number) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, rel });
  };
  for (const r of relations) {
    addEdge(r.source, r.target, r.id);
    addEdge(r.target, r.source, r.id);
  }

  const loops: GraphLoop[] = [];
  const seen = new Set<string>();
  const normKey = (nodes: number[]) => [...nodes].sort((a, b) => a - b).join(",");

  const dfs = (
    start: number,
    current: number,
    pathNodes: number[],
    pathRels: number[],
    visited: Set<number>,
  ) => {
    if (loops.length >= maxLoops) return;
    for (const { to, rel } of adj.get(current) || []) {
      if (pathRels.includes(rel)) continue;
      if (to === start && pathNodes.length >= 3) {
        const key = normKey(pathNodes);
        if (seen.has(key)) continue;
        seen.add(key);
        loops.push({ nodeIds: [...pathNodes], relationIds: [...pathRels, rel] });
        continue;
      }
      if (visited.has(to) || pathNodes.length >= maxLen) continue;
      visited.add(to);
      pathNodes.push(to);
      pathRels.push(rel);
      dfs(start, to, pathNodes, pathRels, visited);
      pathRels.pop();
      pathNodes.pop();
      visited.delete(to);
    }
  };

  const starts = [...adj.keys()].sort((a, b) => a - b);
  for (const start of starts) {
    dfs(start, start, [start], [], new Set([start]));
    if (loops.length >= maxLoops) break;
  }

  loops.sort((a, b) => a.nodeIds.length - b.nodeIds.length);
  return loops;
}

export function pickLoopBatch(loops: GraphLoop[], batchIndex: number, perBatch: number) {
  const slice = loops.slice(batchIndex * perBatch, (batchIndex + 1) * perBatch);
  const nodeIds = new Set<number>();
  const relationIds = new Set<number>();
  slice.forEach((loop) => {
    loop.nodeIds.forEach((id) => nodeIds.add(id));
    loop.relationIds.forEach((id) => relationIds.add(id));
  });
  return { loops: slice, nodeIds, relationIds };
}

/**
 * 按连通子图分批：每批从最高连接度未访问节点 BFS 扩展，保证批内节点彼此可达。
 * 避免「按度数切片」导致后续批次节点只连到上一批 hub、批内几乎无边的问题。
 */
export function enumerateConnectedBatches<
  O extends { id: number },
>(
  objects: O[],
  relations: Rel[],
  batchSize: number,
  degreeOf: (id: number) => number,
): Set<number>[] {
  if (objects.length === 0) return [];

  const adj = buildAdjacency(relations);
  const ranked = [...objects].sort((a, b) => degreeOf(b.id) - degreeOf(a.id));
  const globalVisited = new Set<number>();
  const batches: Set<number>[] = [];

  const growFrom = (seed: number): Set<number> => {
    const keep = new Set<number>();
    const queue: number[] = [seed];
    while (queue.length > 0 && keep.size < batchSize) {
      const id = queue.shift()!;
      if (globalVisited.has(id) || keep.has(id)) continue;
      keep.add(id);
      const neighbors = [...(adj.get(id) || [])].sort((a, b) => degreeOf(b) - degreeOf(a));
      for (const n of neighbors) {
        if (keep.size >= batchSize) break;
        if (!keep.has(n) && !globalVisited.has(n)) queue.push(n);
      }
    }
    return keep;
  };

  for (const obj of ranked) {
    if (globalVisited.has(obj.id)) continue;

    const degree = adj.get(obj.id)?.length ?? 0;
    if (degree === 0) {
      const isolated = new Set<number>([obj.id]);
      globalVisited.add(obj.id);
      for (const other of ranked) {
        if (isolated.size >= batchSize) break;
        if (globalVisited.has(other.id)) continue;
        if ((adj.get(other.id)?.length ?? 0) > 0) continue;
        isolated.add(other.id);
        globalVisited.add(other.id);
      }
      batches.push(isolated);
      continue;
    }

    const keep = growFrom(obj.id);
    keep.forEach((id) => globalVisited.add(id));
    if (keep.size > 0) batches.push(keep);
  }

  return batches;
}

export function pickNodeBatch<
  O extends { id: number },
  R extends { id: number; source: number; target: number },
>(
  objects: O[],
  relations: R[],
  batchIndex: number,
  batchSize: number,
  degreeOf: (id: number) => number,
) {
  const batches = enumerateConnectedBatches(objects, relations, batchSize, degreeOf);
  const keep = batches[batchIndex] ?? new Set<number>();
  const rels = relations.filter((r) => keep.has(r.source) && keep.has(r.target));
  return {
    objects: objects.filter((o) => keep.has(o.id)),
    relations: rels,
    keep,
  };
}

export function countConnectedBatches<
  O extends { id: number },
>(
  objects: O[],
  relations: Rel[],
  batchSize: number,
  degreeOf: (id: number) => number,
): number {
  return Math.max(1, enumerateConnectedBatches(objects, relations, batchSize, degreeOf).length);
}
