/**
 * i18n 单测（CANVAS_PLAN.md §9 I1）
 *
 * 重点防「漏译静默回退」：中英键集合必须完全一致、值不得为空、插值不得丢占位符。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CANVAS_NODE_KINDS } from '../../canvas/contract.ts'
import {
  EN_MESSAGE_KEYS,
  LANGUAGES,
  MESSAGE_KEYS,
  nodeHint,
  nodeHintKey,
  nodeLabel,
  nodeLabelKey,
  nodeMessageKeysCovered,
  onboardingTabLabel,
  t,
  templateLabel,
} from '../strings.ts'
import {
  LANGUAGE_STORAGE_KEY,
  __resetLanguageSnapshotForTest,
  getLanguageSnapshot,
  isLanguage,
  readLanguage,
  resolveInitialLanguage,
  setLanguage,
  subscribeLanguage,
  writeLanguage,
} from '../language.ts'

/** 内存 Storage stub（node 环境无 localStorage） */
function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    _map: map,
  }
}

/* ---------------- 字典完整性 ---------------- */

describe('字典完整性（防漏译静默回退）', () => {
  it('中英键集合完全一致（无缺键、无多余键）', () => {
    assert.deepEqual([...EN_MESSAGE_KEYS].sort(), [...MESSAGE_KEYS].sort())
  })

  it('键数量非平凡（覆盖顶栏/工具条/节点/对话栏/开场层/设置）', () => {
    assert.ok(MESSAGE_KEYS.length >= 60, `键数量偏少：${MESSAGE_KEYS.length}`)
  })

  it('所有中英文案非空（trim 后仍有内容）', () => {
    for (const key of MESSAGE_KEYS) {
      for (const lang of LANGUAGES) {
        assert.ok(t(lang, key).trim().length > 0, `${lang} 的 ${key} 为空`)
      }
    }
  })

  it('英文键不得残留中文字符（漏译检测；「中文」语言名本身除外）', () => {
    for (const key of MESSAGE_KEYS) {
      if (key === 'settings.langZh') continue
      const value = t('en', key)
      assert.ok(!/[\u4e00-\u9fff]/.test(value), `en 的 ${key} 仍含中文：${value}`)
    }
  })

  it('中文键必须与英文不同（英文不得是未翻译的复制）', () => {
    // 白名单：语言名本身两种语言都按原文展示
    const NO_TRANSLATION_NEEDED = new Set(['settings.langZh', 'settings.langEn'])
    const identical = MESSAGE_KEYS.filter((k) => t('zh', k) === t('en', k))
    assert.deepEqual(
      identical.filter((k) => !NO_TRANSLATION_NEEDED.has(k)),
      [],
      `疑似漏译：${identical.join(', ')}`
    )
  })
})

/* ---------------- 取词函数 ---------------- */

describe('t() 取词与插值', () => {
  it('默认中文；切英文返回英文', () => {
    assert.equal(t('zh', 'palette.title'), 'Agent 节点')
    assert.equal(t('en', 'palette.title'), 'Agent nodes')
  })

  it('插值替换已提供的占位符，未提供的原样保留（不静默清空）', () => {
    assert.equal(t('zh', 'toolbar.exportSkillReady', { n: 3 }), '导出选中的 3 个节点为 Skill 包（JSON 下载）')
    assert.ok(t('zh', 'toolbar.savedAt').includes('{time}'), '未传参时应保留占位符')
    assert.equal(t('en', 'toolbar.savedAt', { time: '10:00' }), 'Saved 10:00')
  })

  it('未知键原样返回键名（便于发现漏配）', () => {
    assert.equal(t('en', 'no.such.key' as never), 'no.such.key')
  })
})

/* ---------------- 节点文案覆盖 ---------------- */

describe('节点文案', () => {
  it('每个 kind 都有中英标签与提示', () => {
    assert.deepEqual(nodeMessageKeysCovered().missing, [])
    for (const kind of CANVAS_NODE_KINDS) {
      assert.ok(nodeLabel('zh', kind).length > 0)
      assert.ok(nodeLabel('en', kind).length > 0)
      assert.ok(nodeHint('zh', kind).length > 0)
      assert.ok(nodeHint('en', kind).length > 0)
      assert.equal(nodeLabelKey(kind), `node.${kind}.label`)
      assert.equal(nodeHintKey(kind), `node.${kind}.hint`)
    }
  })

  it('场景模板与开场层 tab：已知 id 命中译文，未知 id 原样返回', () => {
    assert.equal(templateLabel('en', 'ecommerce'), 'Commerce short video')
    assert.equal(templateLabel('zh', 'brand'), '品牌视觉')
    assert.equal(templateLabel('en', 'unknown-id'), 'unknown-id')
    assert.equal(onboardingTabLabel('en', 'web-app'), 'Web apps')
    assert.equal(onboardingTabLabel('zh', 'unknown'), 'unknown')
  })
})

/* ---------------- 语言持久化与订阅 ---------------- */

describe('语言持久化（脏值自愈 → 中文零回归）', () => {
  it('缺失 / 脏值 / 存储不可用 → 默认中文', () => {
    assert.equal(readLanguage(memStorage()), 'zh')
    assert.equal(readLanguage(memStorage({ [LANGUAGE_STORAGE_KEY]: 'fr' })), 'zh')
    assert.equal(readLanguage(memStorage({ [LANGUAGE_STORAGE_KEY]: '{}' })), 'zh')
    assert.equal(readLanguage(null), 'zh')
  })

  it('writeLanguage 往返一致', () => {
    const store = memStorage()
    writeLanguage('en', store)
    assert.equal(store._map.get(LANGUAGE_STORAGE_KEY), 'en')
    assert.equal(readLanguage(store), 'en')
  })

  it('isLanguage 白名单校验', () => {
    assert.equal(isLanguage('zh'), true)
    assert.equal(isLanguage('en'), true)
    assert.equal(isLanguage('EN'), false)
    assert.equal(isLanguage(undefined), false)
  })

  it('resolveInitialLanguage：显式存储优先；无存储时按浏览器语言推断（不写存储）', () => {
    assert.equal(resolveInitialLanguage('en-US', memStorage()), 'en')
    assert.equal(resolveInitialLanguage('zh-CN', memStorage()), 'zh')
    assert.equal(resolveInitialLanguage(undefined, memStorage()), 'zh')
    const store = memStorage({ [LANGUAGE_STORAGE_KEY]: 'zh' })
    assert.equal(resolveInitialLanguage('en-US', store), 'zh', '显式存储必须压过浏览器推断')
    assert.equal(store._map.size, 1, '推断结果不得写回存储')
  })
})

describe('语言 store 订阅', () => {
  it('setLanguage 通知订阅者；同值不重复通知；快照同步更新', () => {
    __resetLanguageSnapshotForTest()
    let calls = 0
    const off = subscribeLanguage(() => {
      calls++
    })
    const before = getLanguageSnapshot()
    setLanguage('en')
    assert.equal(calls, 1)
    assert.equal(getLanguageSnapshot(), 'en')
    setLanguage('en')
    assert.equal(calls, 1, '同值不应再次通知')
    setLanguage(before)
    assert.equal(calls, 2)
    off()
    setLanguage('en')
    assert.equal(calls, 2, '退订后不再通知')
    __resetLanguageSnapshotForTest()
  })
})
