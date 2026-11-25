import { isDeferred, isUnclear, replacedQuestionIds } from './answers.mjs';

// Read-only projections shared by the renderer and document bridge.
export function primaryGraph(tree) {
  const entries = new Map(tree.nodes.map((node, index) => [node.id, { node, index }])),
    visiting = new Set();
  function resolve(entry) {
    if (entry.depth !== undefined) return entry;
    if (visiting.has(entry.node.id)) throw Error('dependency cycle');
    visiting.add(entry.node.id);
    const deps = entry.node.depends_on.map(id => entries.get(id));
    if (deps.some(x => !x)) throw Error('unknown dependency');
    deps.sort((a, b) => b.node.round - a.node.round || b.index - a.index);
    const parent = deps[0] ? resolve(deps[0]) : null;
    Object.assign(entry, {
      parentId: parent?.node.id ?? null,
      rootId: parent?.rootId ?? entry.node.id,
      depth: parent ? parent.depth + 1 : 0
    });
    visiting.delete(entry.node.id);
    return entry;
  }
  return [...entries.values()].map(resolve);
}
export const chapterAnchor = id =>
  'topic-' +
  Array.from({ length: id.length }, (_, i) => id.charCodeAt(i).toString(16).padStart(4, '0')).join(
    ''
  );
export function chapters(tree) {
  const explicit = node => (tree.schema_version === 2 ? node.chapter_id : undefined);
  const fallback = tree.nodes.some(node => explicit(node) === undefined)
    ? new Map(primaryGraph(tree).map(e => [e.node.id, e.rootId]))
    : null;
  const frozen = tree.status === 'complete',
    replaced = frozen ? replacedQuestionIds(tree.nodes) : new Set(),
    members = tree.nodes.filter(node => !replaced.has(node.id)).map(node => {
      if (!frozen || !isUnclear(node.answer)) return node;
      // The chapter writer renders deferred answers under 待确认.
      const { option_ids, text } = node.answer;
      return { ...node, answer: { option_ids, text, deferred: true } };
    });
  return tree.nodes
    .filter(node => node.depends_on.length === 0)
    .map(root => ({
      id: root.id,
      anchor: chapterAnchor(root.id),
      title: root.question,
      nodes: members.filter(node => (explicit(node) ?? fallback.get(node.id)) === root.id)
    }))
    .filter(chapter => chapter.nodes.length);
}
export function answerText(node, answer = node.answer) {
  return !answer
    ? '尚未回答'
    : [
        isUnclear(answer) ? '没看懂' : '',
        ...node.options.filter(o => answer.option_ids.includes(o.id)).map(o => o.label),
        answer.text
      ]
        .filter(Boolean)
        .join('\n');
}
export function displayAnswer(node, answer = node.answer) {
  const text = answerText(node, answer);
  return isDeferred(answer) ? ['待定', text].filter(Boolean).join('\n') : text;
}
