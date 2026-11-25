export const isDeferred = answer => answer?.deferred === true;
export const isUnclear = answer => answer?.unclear === true;
export const isUnresolved = answer => isDeferred(answer) || isUnclear(answer);

// One confirmed answer as handed to grow-loop: selected labels, then the verbatim note.
export const decisionText = (labels, text) =>
  [labels.length && '你选：' + labels.join('；'), text && '你的原话：' + text]
    .filter(Boolean)
    .join('\n');

export function replacedQuestionIds(nodes) {
  const targets = new Set(nodes.filter(n => n.rephrases && n.status === 'answered').map(n => n.rephrases));
  return new Set(nodes.filter(n => targets.has(n.id) && isUnclear(n.answer)).map(n => n.id));
}

// Shared answer rules. A recommendation never changes this value.
export function selectionValid(node, answer) {
  if (!answer || !Array.isArray(answer.option_ids) || typeof answer.text !== 'string') return false;
  if (isDeferred(answer) && isUnclear(answer)) return false;
  const ids = answer.option_ids;
  if (!ids.every(id => typeof id === 'string') || new Set(ids).size !== ids.length) return false;
  if (node.input === 'text')
    return ids.length === 0 && (isUnresolved(answer) || answer.text.trim().length > 0);
  if (!ids.length)
    return isUnresolved(answer) && ['single_choice', 'multi_choice'].includes(node.input);
  if (ids.some(id => !node.options.some(option => option.id === id))) return false;
  if (node.input === 'single_choice') return ids.length === 1;
  return (
    node.input === 'multi_choice' &&
    (ids.length === 1 || !node.options.some(option => option.exclusive && ids.includes(option.id)))
  );
}

// Preserve the original encoding and append only the active unresolved flag.
export function recommendationBasis(tree, sourceIds) {
  return JSON.stringify(
    sourceIds.map(id => {
      const answer = tree.nodes.find(n => n.id === id)?.answer;
      return {
        id,
        answer: answer
          ? {
              option_ids: answer.option_ids,
              text: answer.text,
              ...(isDeferred(answer) ? { deferred: true } : {}),
              ...(isUnclear(answer) ? { unclear: true } : {})
            }
          : null
      };
    })
  );
}
