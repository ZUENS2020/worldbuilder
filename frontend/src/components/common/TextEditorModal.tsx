import { useEffect, useRef, useState } from 'react';

interface TextEditorModalProps {
  title: string;
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
}

// Centered large editor for long-form fields (backstory, prose, etc.)
export default function TextEditorModal({ title, initialValue, onSave, onClose }: TextEditorModalProps) {
  const [value, setValue] = useState(initialValue);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { onSave(value); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onSave, onClose]);

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
        style={{ width: 'min(820px, 86vw)', height: 'min(640px, 84vh)', boxShadow: '0 12px 48px rgba(0,0,0,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mt-panel-title" style={{ justifyContent: 'space-between', height: 30, flex: '0 0 30px' }}>
          <span>✍️ {title}</span>
          <span style={{ fontSize: 10, color: 'var(--mt-text-muted)', fontWeight: 400 }}>{value.length} 字 · ⌘/Ctrl+Enter 保存 · Esc 关闭</span>
        </div>
        <div style={{ flex: 1, padding: 12, minHeight: 0, display: 'flex' }}>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              flex: 1, width: '100%', resize: 'none', border: '1px solid var(--mt-border)',
              borderRadius: 4, padding: '12px 14px', fontSize: 14, lineHeight: 1.7,
              color: 'var(--mt-text)', outline: 'none', fontFamily: 'inherit',
            }}
          />
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
