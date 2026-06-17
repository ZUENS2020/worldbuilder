import { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import { useTextHistory } from '../../hooks/useTextHistory';

interface TextEditorModalProps {
  title: string;
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
}

type ViewMode = 'edit' | 'preview' | 'split';

// Centered large editor for long-form fields (backstory, prose, etc.)
export default function TextEditorModal({ title, initialValue, onSave, onClose }: TextEditorModalProps) {
  const h = useTextHistory(initialValue);
  const value = h.value;
  const [view, setView] = useState<ViewMode>('split');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    taRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { onSave(valueRef.current); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,30,45,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="mt-panel"
        style={{ width: 'min(900px, 90vw)', height: 'min(680px, 86vh)', boxShadow: '0 12px 48px rgba(0,0,0,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mt-panel-title" style={{ justifyContent: 'space-between', height: 30, flex: '0 0 30px' }}>
          <span>✍️ {title}</span>
          <span style={{ fontSize: 10, color: 'var(--mt-text-muted)', fontWeight: 400 }}>{value.length} 字 · ⌘/Ctrl+Enter 保存 · Esc 关闭</span>
        </div>

        {/* Toolbar: view toggle + undo/redo */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          borderBottom: '1px solid var(--mt-border-soft)', flex: '0 0 auto',
        }}>
          <div style={{ display: 'flex', border: '1px solid var(--mt-border)', borderRadius: 4, overflow: 'hidden' }}>
            {([['edit', '编辑'], ['preview', '预览'], ['split', '分栏']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  fontSize: 11, padding: '3px 10px', border: 'none', cursor: 'pointer',
                  background: view === key ? 'var(--mt-accent)' : 'transparent',
                  color: view === key ? '#fff' : 'var(--mt-text-muted)',
                  fontWeight: view === key ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button className="mt-btn" onClick={h.undo} disabled={!h.canUndo} title="撤销 (⌘/Ctrl+Z)" style={{ fontSize: 13, padding: '2px 8px', border: '1px solid var(--mt-border)' }}>↶</button>
          <button className="mt-btn" onClick={h.redo} disabled={!h.canRedo} title="重做 (⌘/Ctrl+Shift+Z)" style={{ fontSize: 13, padding: '2px 8px', border: '1px solid var(--mt-border)' }}>↷</button>
        </div>

        <div style={{ flex: 1, padding: 12, minHeight: 0, display: 'flex', gap: 12 }}>
          {(view === 'edit' || view === 'split') && (
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => h.set(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                h.set(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (composingRef.current && e.key !== 'Escape') return;
                h.onKeyDown(e);
              }}
              style={{
                flex: 1, width: '100%', resize: 'none', border: '1px solid var(--mt-border)',
                borderRadius: 4, padding: '12px 14px', fontSize: 14, lineHeight: 1.7,
                color: 'var(--mt-text)', outline: 'none', fontFamily: 'inherit',
              }}
            />
          )}
          {(view === 'preview' || view === 'split') && (
            <div style={{
              flex: 1, minWidth: 0, overflowY: 'auto', border: '1px solid var(--mt-border)',
              borderRadius: 4, padding: '12px 16px', background: '#fff',
            }}>
              <Markdown>{value}</Markdown>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 12px 12px' }}>
          <button className="mt-btn" style={{ border: '1px solid var(--mt-border)' }} onClick={onClose}>取消</button>
          <button className="mt-btn active" style={{ fontWeight: 600, border: '1px solid var(--mt-accent)' }} onClick={() => { onSave(value); onClose(); }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
