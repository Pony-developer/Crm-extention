import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type AutocompleteOption = {
  name: string;
  label?: string;
  kind?: string;
  /** Text written into the input when picked; defaults to `name`. */
  insert?: string;
};

/** `from` is the index in the text before the caret where the replaced token starts. */
export type Suggestions = { from: number; items: AutocompleteOption[] };
export type SuggestionProvider = (textBeforeCaret: string, isStale: () => boolean) => Suggestions | null | Promise<Suggestions | null>;

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** Comma separated names ($select, $expand, $orderby) completed from `options`. */
  mode?: 'list';
  options?: AutocompleteOption[];
  /** Context-aware completion, for example $filter. Takes over from `mode` and `options`. */
  provider?: SuggestionProvider;
};

const MAX_ITEMS = 50;
const LIST_MAX_WIDTH = 340;
const LIST_MAX_HEIGHT = 180;
const EDGE = 8;
const WORD = /^[A-Za-z0-9_.-]*/;

export function listSuggestions(value: string, caret: number, options: AutocompleteOption[]): { from: number; items: AutocompleteOption[] } | null {
  const before = value.slice(0, caret);
  // No suggestions inside nested options such as $expand=a($select=b).
  if ((before.match(/\(/g) ?? []).length > (before.match(/\)/g) ?? []).length) return null;
  const typed = /[A-Za-z0-9_]*$/.exec(before)?.[0] ?? '';
  if (!typed && !/(^|,)\s*$/.test(before)) return null;
  const query = typed.toLowerCase();
  const used = new Set(value.split(',').map(part => part.trim().split(/[\s(]/)[0]));
  const rank = (option: AutocompleteOption) => {
    const name = option.name.toLowerCase();
    if (!query) return 1;
    if (name.startsWith(query)) return 0;
    if (name.includes(query)) return 1;
    return option.label?.toLowerCase().includes(query) ? 2 : -1;
  };
  const items = options
    .filter(option => (!used.has(option.name) || option.name === typed) && rank(option) >= 0)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, MAX_ITEMS);
  return { from: caret - typed.length, items };
}

export function Autocomplete({ value, onChange, options = [], placeholder, ariaLabel, provider }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [asyncResult, setAsyncResult] = useState<Suggestions | null>(null);

  const syncResult = useMemo(
    () => (open && !provider ? listSuggestions(value, caret, options) : null),
    [open, provider, value, caret, options],
  );

  useEffect(() => {
    if (!open || !provider) { setAsyncResult(null); return; }
    let stale = false;
    const outcome = provider(value.slice(0, caret), () => stale);
    if (outcome instanceof Promise) outcome.then(result => { if (!stale) setAsyncResult(result); }, () => { if (!stale) setAsyncResult(null); });
    else setAsyncResult(outcome);
    return () => { stale = true; };
  }, [open, provider, value, caret]);

  const result = provider ? asyncResult : syncResult;
  const items = result?.items.slice(0, MAX_ITEMS) ?? [];
  const textTyped = result ? value.slice(result.from, caret) : '';
  const visible = items.length > 0 && !(items.length === 1 && (items[0]?.insert ?? items[0]?.name) === textTyped);

  const pick = (option: AutocompleteOption) => {
    if (!result) return;
    const text = option.insert ?? option.name;
    const end = caret + (WORD.exec(value.slice(caret))?.[0].length ?? 0);
    const position = result.from + text.length;
    onChange(value.slice(0, result.from) + text + value.slice(end));
    setCaret(position);
    setActive(0);
    requestAnimationFrame(() => input.current?.setSelectionRange(position, position));
  };

  // The list is fixed to the viewport so it can never widen the panel; it is kept inside the window and flips upwards when there is no room below.
  const [place, setPlace] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 200), LIST_MAX_WIDTH, window.innerWidth - EDGE * 2);
      const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
      const below = window.innerHeight - rect.bottom - EDGE;
      const above = rect.top - EDGE;
      const flip = below < 120 && above > below;
      setPlace(flip
        ? { left, width, bottom: window.innerHeight - rect.top + 3, maxHeight: Math.min(LIST_MAX_HEIGHT, above) }
        : { left, width, top: rect.bottom + 3, maxHeight: Math.min(LIST_MAX_HEIGHT, Math.max(below, 80)) });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [visible]);

  const track = (element: HTMLInputElement) => { setCaret(element.selectionStart ?? element.value.length); };

  return (
    <div className="ac">
      <input
        ref={input}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={visible}
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={event => { onChange(event.target.value); track(event.target); setOpen(true); setActive(0); }}
        onFocus={event => { track(event.target); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onClick={event => track(event.currentTarget)}
        onKeyUp={event => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) track(event.currentTarget); }}
        onKeyDown={event => {
          if (!visible) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % items.length); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + items.length) % items.length); }
          else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); const chosen = items[Math.min(active, items.length - 1)]; if (chosen) pick(chosen); }
          else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        }}
      />
      {visible && (
        <ul className="ac-list" role="listbox" style={place}>
          {items.map((option, index) => (
            <li
              key={`${option.name}|${option.insert ?? ''}|${index}`}
              role="option"
              title={[option.name, [option.label, option.kind].filter(Boolean).join(' · ')].filter(Boolean).join('\n')}
              aria-selected={index === active}
              className={index === active ? 'active' : ''}
              ref={element => { if (index === active) element?.scrollIntoView({ block: 'nearest' }); }}
              onMouseDown={event => { event.preventDefault(); pick(option); }}
              onMouseEnter={() => setActive(index)}
            >
              <code>{option.name}</code>
              {(option.label || option.kind) && <small>{[option.label, option.kind].filter(Boolean).join(' · ')}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
