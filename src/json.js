// Robust extraction of a JSON object from model output. Models are asked to
// return bare JSON, but they occasionally wrap it in code fences or a line of
// prose; the protocol should not fall over when they do.

export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('extractJson: expected string');

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`Could not extract JSON from model output: ${text.slice(0, 200)}`);
}
