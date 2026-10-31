// skill 分類
// 判斷順序：SKILL.md 的 metadata.category → 設定檔 categories 對照表 → categoryRules 關鍵字自動判斷 → 未分類

export const UNCATEGORIZED = '未分類';

export function createCategorizer({ categories = {}, categoryRules = {} } = {}) {
  const byName = new Map();
  for (const [cat, names] of Object.entries(categories)) for (const n of names) byName.set(n, cat);
  // 英數關鍵字要整個字相符（避免 ig 命中 design），中文用包含
  const toTest = (w) => {
    const s = w.toLowerCase();
    if (!/^[a-z0-9 ._-]+$/.test(s)) return (text) => text.includes(s);
    const re = new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
    return (text) => re.test(text);
  };
  const rules = Object.entries(categoryRules).map(([cat, words]) => [cat, words.map(toTest)]);

  return function categorize(skill) {
    if (skill.categoryMeta) return { category: String(skill.categoryMeta), source: 'skill' };
    const key = skill.name || skill.folder;
    if (byName.has(key)) return { category: byName.get(key), source: 'config' };
    // 名稱與觸發詞權重較高，description 其次；分數最高的分類勝出
    const strong = [key, ...skill.triggers].join(' ').toLowerCase();
    const weak = (skill.description || '').toLowerCase();
    let best = null;
    for (const [cat, words] of rules) {
      const score = words.reduce((a, test) => a + (test(strong) ? 2 : 0) + (test(weak) ? 1 : 0), 0);
      if (score > 0 && (!best || score > best.score)) best = { cat, score };
    }
    return best ? { category: best.cat, source: 'auto' } : { category: UNCATEGORIZED, source: 'none' };
  };
}

/** 分類顯示順序：設定檔裡的順序 → 自動規則的順序 → 其他依字母 → 未分類最後 */
export function categoryOrder(skills, { categories = {}, categoryRules = {} } = {}) {
  const preferred = [...Object.keys(categories), ...Object.keys(categoryRules)];
  const present = [...new Set(skills.map((s) => s.category))];
  const rank = (c) => (c === UNCATEGORIZED ? Infinity : preferred.includes(c) ? preferred.indexOf(c) : preferred.length);
  return present.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
