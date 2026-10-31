// SKILL.md frontmatter 的精簡 YAML 解析：只支援 skill 會用到的寫法
// （單行值、| 或 > 區塊、多行純文字延續、一層巢狀 map 如 metadata:）
// 不引入 YAML 套件，維持零相依。

const KEY_RE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  return v.replace(/\s+#.*$/, ''); // 行尾註解
}

const indentOf = (line) => line.match(/^[ \t]*/)[0].length;

// 從 lines[start] 開始收集縮排大於 parentIndent 的行
function collect(lines, start, parentIndent) {
  const out = [];
  let i = start;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { out.push(''); continue; }
    if (indentOf(l) <= parentIndent) break;
    out.push(l);
  }
  while (out.length && out.at(-1) === '') out.pop();
  return { block: out, next: i };
}

function blockScalar(indicator, block) {
  const nonEmpty = block.filter((l) => l.trim());
  const min = nonEmpty.length ? Math.min(...nonEmpty.map(indentOf)) : 0;
  const body = block.map((l) => l.slice(min));
  if (indicator.startsWith('>')) {
    // 摺疊：相鄰行用空白接，空行變換行
    return body.reduce((acc, l) => (l === '' ? acc + '\n' : acc && !acc.endsWith('\n') ? `${acc} ${l}` : acc + l), '').trim();
  }
  return body.join('\n').trim();
}

function parseMap(lines, baseIndent) {
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const ind = indentOf(line);
    const m = line.trim().match(KEY_RE);
    if (ind !== baseIndent || !m) { i++; continue; }
    const key = m[1];
    const rest = (m[2] ?? '').trim();
    const { block, next } = collect(lines, i + 1, ind);
    if (/^[|>][-+]?$/.test(rest)) {
      obj[key] = blockScalar(rest, block);
    } else if (rest === '' && block.length) {
      const childIndent = indentOf(block.find((l) => l.trim()));
      const first = block.find((l) => l.trim()).trim();
      if (first.startsWith('- ')) {
        obj[key] = block.filter((l) => l.trim().startsWith('- ')).map((l) => unquote(l.trim().slice(2)));
      } else if (KEY_RE.test(first)) {
        obj[key] = parseMap(block, childIndent);
      } else {
        obj[key] = block.map((l) => l.trim()).filter(Boolean).join(' ');
      }
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      obj[key] = rest.slice(1, -1).split(',').map((s) => unquote(s)).filter(Boolean);
    } else {
      // 純文字值可能延續到下面縮排的行
      const cont = block.map((l) => l.trim()).filter(Boolean);
      obj[key] = unquote([rest, ...cont].join(' '));
    }
    i = next;
  }
  return obj;
}

/** 拆出 frontmatter 與本文；沒有 frontmatter 時 data 為 null */
export function parseSkillFile(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { data: null, body: text };
  return { data: parseMap(m[1].split('\n'), 0), body: text.slice(m[0].length) };
}
