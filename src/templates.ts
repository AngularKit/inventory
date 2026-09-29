/** Small static HTML reader; it does not evaluate Angular expressions or CSS selectors. */
export interface TemplateTag { start: number; snippet: string; name: string; attributes: Map<string, string> }

export function templateTags(template: string): TemplateTag[] {
  const tags: TemplateTag[] = [];
  const starts = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<([a-zA-Z][\w-]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(template))) {
    if (!match[2]) continue;
    let quote = '', end = starts.lastIndex;
    for (; end < template.length; end++) {
      const char = template[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === template.length) break;
    const snippet = template.slice(match.index, end + 1);
    const attributes = new Map<string, string>();
    const attr = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const body = template.slice(starts.lastIndex, end);
    for (const m of body.matchAll(attr)) {
      const value = m[2] ?? m[3] ?? m[4] ?? '';
      let name = m[1];
      if (name.startsWith('(') || name.startsWith('#') || name.startsWith('*')) continue;
      name = name.replace(/^\[\((.*)\)\]$/, '$1').replace(/^\[(.*)\]$/, '$1');
      attributes.set(name, value);
    }
    tags.push({ start: match.index, snippet, name: match[2], attributes });
    starts.lastIndex = end + 1;
  }
  return tags;
}

export function matchesSelector(tag: TemplateTag, selector: string): boolean {
  const parsed = selector.match(/^([\w-]+)?((?:\[[\w-]+\])*)$/);
  if (!parsed || (!parsed[1] && !parsed[2])) return false;
  return (!parsed[1] || tag.name === parsed[1])
    && [...parsed[2].matchAll(/\[([\w-]+)\]/g)].every((m) => tag.attributes.has(m[1]));
}
