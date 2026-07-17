import type { HierarchyNode, LoopLevel } from "./types";

/** 公司 → 品牌 → 平台 → 渠道 → 链接 → SKU 样例实体树 */
export const SAMPLE_ROOT: HierarchyNode = {
  id: "co-root",
  name: "良策代理公司（样例）",
  level: "company",
  children: [
    {
      id: "br-alpha",
      name: "示例品牌 · 花语",
      level: "brand",
      children: [
        {
          id: "pf-tmall",
          name: "天猫",
          level: "platform",
          children: [
            {
              id: "ch-flagship",
              name: "花语旗舰店",
              level: "channel",
              children: [
                {
                  id: "lk-serum",
                  name: "精华液链接 · 多规格",
                  level: "link",
                  children: [
                    { id: "sku-30ml", name: "精华 30ml", level: "sku" },
                    { id: "sku-50ml", name: "精华 50ml", level: "sku" },
                  ],
                },
                {
                  id: "lk-cream",
                  name: "面霜链接",
                  level: "link",
                  children: [
                    { id: "sku-cream", name: "面霜 50g", level: "sku" },
                  ],
                },
              ],
            },
            {
              id: "ch-outlet",
              name: "花语专卖店",
              level: "channel",
              children: [
                {
                  id: "lk-set",
                  name: "套装链接",
                  level: "link",
                  children: [
                    { id: "sku-set-a", name: "套装 A", level: "sku" },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "pf-douyin",
          name: "抖音",
          level: "platform",
          children: [
            {
              id: "ch-dy",
              name: "花语抖音店",
              level: "channel",
              children: [
                {
                  id: "lk-dy-hot",
                  name: "爆款短视频链",
                  level: "link",
                  children: [
                    { id: "sku-dy-1", name: "爆款 SKU", level: "sku" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "br-beta",
      name: "示例品牌 · 澄光",
      level: "brand",
      children: [
        {
          id: "pf-jd",
          name: "京东",
          level: "platform",
          children: [
            {
              id: "ch-jd",
              name: "澄光京东自营店",
              level: "channel",
              children: [
                {
                  id: "lk-jd",
                  name: "主推链接",
                  level: "link",
                  children: [
                    { id: "sku-jd-1", name: "主推 SKU", level: "sku" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export function findNode(root: HierarchyNode, id: string): HierarchyNode | null {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** 从根到目标节点的路径（含目标） */
export function pathToNode(root: HierarchyNode, id: string): HierarchyNode[] {
  const walk = (node: HierarchyNode, trail: HierarchyNode[]): HierarchyNode[] | null => {
    const next = [...trail, node];
    if (node.id === id) return next;
    for (const child of node.children || []) {
      const hit = walk(child, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, []) || [root];
}

/** 取某层上「路径中对应节点」的第一个子节点，用于按层级条跳转时落在样例实体上 */
export function pickEntityAtLevel(
  path: HierarchyNode[],
  targetLevel: LoopLevel,
  root: HierarchyNode,
): HierarchyNode {
  const onPath = path.find((n) => n.level === targetLevel);
  if (onPath) return onPath;

  // 路径上没有该层：从最近的公共祖先向下取第一条枝
  const order: LoopLevel[] = ["company", "brand", "platform", "channel", "link", "sku", "fact"];
  const targetIdx = order.indexOf(targetLevel);
  let node = root;
  for (let i = 0; i <= targetIdx; i++) {
    const level = order[i];
    if (node.level === level && i === targetIdx) return node;
    if (node.level === level && node.children?.length) {
      // 优先沿当前 path 的下一节
      const nextOnPath = path.find((n) => n.level === order[i + 1]);
      if (nextOnPath && node.children.some((c) => c.id === nextOnPath.id)) {
        node = nextOnPath;
      } else {
        node = node.children[0];
      }
    }
  }
  return node;
}

export function firstChild(node: HierarchyNode): HierarchyNode | null {
  return node.children?.[0] ?? null;
}
