import { useCallback, useEffect, useRef, useState } from 'react';

/** Keys mirrored on entity.name — never show as editable/deletable properties. */
export const RESERVED_ENTITY_PROPERTY_KEYS = new Set(['name', 'label']);

type ImeInputProps = {
  value: string;
  onCommit: (value: string) => void;
  style?: React.CSSProperties;
  className?: string;
  placeholder?: string;
  title?: string;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
};

/**
 * Text input that keeps a local draft while typing and commits on blur.
 * Works correctly with CJK IME (composition events are not interrupted by parent updates).
 */
export function ImeInput({ value, onCommit, style, className, placeholder, title, onFocus, onBlur }: ImeInputProps) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    if (draft !== value) onCommit(draft);
  }, [draft, value, onCommit]);

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
      }}
      onBlur={(e) => {
        onBlur?.(e);
        if (!composing.current) commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      style={style}
      className={className}
      placeholder={placeholder}
      title={title}
      onFocus={onFocus}
    />
  );
}

type ImeTextareaProps = {
  value: string;
  onCommit: (value: string) => void;
  style?: React.CSSProperties;
  rows?: number;
  placeholder?: string;
  title?: string;
};

export function ImeTextarea({ value, onCommit, style, rows = 4, placeholder, title }: ImeTextareaProps) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    if (draft !== value) onCommit(draft);
  }, [draft, value, onCommit]);

  return (
    <textarea
      value={draft}
      rows={rows}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
      }}
      onBlur={() => {
        if (!composing.current) commit();
      }}
      style={style}
      placeholder={placeholder}
      title={title}
    />
  );
}
