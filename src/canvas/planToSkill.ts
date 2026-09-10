/**
 * B6 编排计划 → Skill manifest 转换（CANVAS_PLAN.md §9 E2「通过对话创建技能」）
 *
 * 复用 S1 契约（skillManifestSchema）与 B6 编排契约（orchestrationPlanSchema），
 * 契约层只扩不破：本模块是两个既有契约之间的纯函数桥，不新增 schema 字段。
 *
 * 转换规则（与 extractSkillManifest 同语义）：
 * - 槽位：按 plan.nodes 顺序 slot-1..N（确定性）；
 * - 坐标：横向链式网格（x = index*380, y = 0），尺寸与编排落位尺寸表一致；
 * - params：filterOrchestrationParams 白名单二次收窄（值类型/枚举兜底）；
 * - edges：下标直传（plan 与 manifest 的边都是 nodes 数组下标）；
 * - inputs：入口节点（无入边）的白名单参数槽；outputs：终点节点（无出边）；
 * - 终检：validateSkillManifestDetailed 整体校验，不合法返回 null（调用方如实提示，绝不入库半成品）。
 */
import {
  CANVAS_NODE_META,
  SKILL_MANIFEST_VERSION,
  SKILL_PARAM_KEYS,
  SKILL_PARAM_LABELS,
  filterOrchestrationParams,
  validateSkillManifest,
  type OrchestrationPlan,
  type SkillManifest,
} from './contract.ts'

/** 转换用节点尺寸（与 applyOrchestrationPlan / addNode 落位尺寸一致） */
const ORCH_NODE_SIZES: Record<string, [number, number]> = {
  brief: [260, 160],
  product: [300, 320],
  script: [300, 220],
  storyboard: [300, 560],
  generate: [300, 320],
  deliver: [300, 320],
}
const ORCH_NODE_GAP_X = 380

export type PlanToSkillResult =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; reason: string }

/**
 * OrchestrationPlan → SkillManifest（纯函数，node --test 可跑）。
 * 失败一律返回 { ok:false, reason }（中文原因，UI 直接展示），绝不返回半成品 manifest。
 */
export function orchestrationPlanToSkillManifest(
  plan: OrchestrationPlan,
  name: string
): PlanToSkillResult {
  if (plan.nodes.length < 2) {
    return { ok: false, reason: '编排计划不足 2 个节点，无法沉淀为 Skill（Skill 至少需要一条连线）' }
  }

  const nodes = plan.nodes.map((n, index) => {
    const [w, h] = ORCH_NODE_SIZES[n.kind] ?? [260, 160]
    return {
      slot: `slot-${index + 1}`,
      kind: n.kind,
      x: index * ORCH_NODE_GAP_X,
      y: 0,
      w,
      h,
      params: filterOrchestrationParams(n.kind, n.params),
    }
  })

  const hasIncoming = new Set(plan.edges.map((e) => e.to))
  const hasOutgoing = new Set(plan.edges.map((e) => e.from))
  const inputs = nodes.flatMap((node, i) =>
    hasIncoming.has(i)
      ? []
      : (SKILL_PARAM_KEYS[node.kind] ?? []).map((key) => ({
          slot: node.slot,
          paramKey: key,
          label: `${CANVAS_NODE_META[node.kind].label} · ${SKILL_PARAM_LABELS[key] ?? key}`,
        }))
  )
  const outputs = nodes
    .filter((_, i) => !hasOutgoing.has(i))
    .map((node) => ({ slot: node.slot, label: CANVAS_NODE_META[node.kind].label }))

  const manifest: SkillManifest = {
    version: SKILL_MANIFEST_VERSION,
    name: name.trim().slice(0, 120) || '对话创建的 Skill',
    nodes,
    edges: plan.edges.map((e) => ({ from: e.from, to: e.to })),
    inputs,
    outputs,
  }

  if (!validateSkillManifest(manifest)) {
    return { ok: false, reason: '编排计划不满足 Skill 契约（连线类型不兼容或参数槽位非法）' }
  }
  return { ok: true, manifest }
}
