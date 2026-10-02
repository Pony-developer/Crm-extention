/** Closes an unterminated string literal and any parentheses left open, e.g. `contains(name,'a` -> `contains(name,'a')`. */
export function closeBrackets(text: string) {
  let inQuote = false;
  let open = 0;
  for (const char of text) {
    if (char === "'") inQuote = !inQuote;
    else if (inQuote) continue;
    else if (char === '(') open++;
    else if (char === ')' && open > 0) open--;
  }
  return text + (inQuote ? "'" : '') + ')'.repeat(open);
}
