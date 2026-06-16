import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, RELATION_CONFIG } from '../../types';
import type { EntityType } from '../../types';

interface Candidate {
  target_name: string;
  target_type: string;
  relation_type: string;
  description: string;
  confidence: number;
  exists: boolean;
  source_entity_id: string;
}

interface AISuggestionReviewProps {
  candidates: Candidate[];
  onAccept: (selected: Candidate[]) => void;
  onDismiss: () => void;
}

export default function AISuggestionReview({ candidates, onAccept, onDismiss }: AISuggestionReviewProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set(candidates.map((_, i) => i)));
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, Partial<Candidate>>>({});

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const getCandidate = (idx: number): Candidate => ({
    ...candidates[idx],
    ...(edits[idx] || {}),
  });

  const updateEdit = (idx: number, field: keyof Candidate, value: any) => {
    setEdits((prev) => ({
      ...prev,
      [idx]: { ...prev[idx], [field]: value },
    }));
  };

  const handleAccept = () => {
    const accepted = Array.from(selected).map((i) => getCandidate(i));
    onAccept(accepted);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={onDismiss}
    >
      <div
        style={{
          background: 'var(--mt-panel)', borderRadius: 8,
          border: '1px solid var(--mt-border)',
          width: 'min(600px, 90vw)', maxHeight: '80vh',
          boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: 'var(--mt-text)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--mt-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>🔮 AI 推断结果预览</span>
          <span style={{ color: 'var(--mt-text-muted)', fontSize: 11 }}>
            勾选后点「应用所选」入库，未勾选的将被丢弃
          </span>
        </div>

        {/* Candidate list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {candidates.map((c, idx) => {
            const edited = getCandidate(idx);
            const entityConfig = ENTITY_CONFIG[edited.target_type as EntityType] || ENTITY_CONFIG.character;
            const relConfig = RELATION_CONFIG[edited.relation_type] || { color: '#888', label: edited.relation_type };
            const isEditing = editingIdx === idx;
            const isChecked = selected.has(idx);

            return (
              <div
                key={idx}
                style={{
                  padding: '8px 10px', marginBottom: 4, borderRadius: 4,
                  border: `1px solid ${isChecked ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
                  background: isChecked ? 'var(--mt-accent-bg)' : 'transparent',
                  opacity: isChecked ? 1 : 0.5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(idx)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 16 }}>{entityConfig.icon}</span>

                  {isEditing ? (
                    <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <input
                        value={edited.target_name}
                        onChange={(e) => updateEdit(idx, 'target_name', e.target.value)}
                        style={{ flex: 1, minWidth: 80, padding: '2px 6px', fontSize: 12,
                          background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                          borderRadius: 3, color: 'var(--mt-text)' }}
                      />
                      <select
                        value={edited.relation_type}
                        onChange={(e) => updateEdit(idx, 'relation_type', e.target.value)}
                        style={{ padding: '2px 6px', fontSize: 11,
                          background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                          borderRadius: 3, color: 'var(--mt-text)' }}
                      >
                        {Object.entries(RELATION_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setEditingIdx(null)}
                        className="mt-btn"
                        style={{ fontSize: 10, padding: '1px 8px' }}
                      >✓</button>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{edited.target_name}</span>
                      {c.exists && <span style={{ fontSize: 9, color: 'var(--mt-text-muted)', background: 'var(--mt-window)', padding: '0 4px', borderRadius: 3 }}>已存在</span>}
                      <span style={{
                        color: relConfig.color, fontSize: 10,
                        background: `${relConfig.color}22`, padding: '1px 6px', borderRadius: 3,
                      }}>
                        {relConfig.label}
                      </span>
                      <span style={{ color: 'var(--mt-text-muted)', fontSize: 10 }}>
                        {Math.round(edited.confidence * 100)}%
                      </span>
                      <button
                        onClick={() => setEditingIdx(idx)}
                        className="mt-btn"
                        style={{ fontSize: 9, padding: '0 4px', marginLeft: 'auto' }}
                      >✏️</button>
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <div style={{ marginLeft: 30, marginTop: 2, color: 'var(--mt-text-muted)', fontSize: 11 }}>
                    {edited.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--mt-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: 'var(--mt-text-muted)', fontSize: 11 }}>
            已选 {selected.size}/{candidates.length} 项
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="mt-btn" onClick={onDismiss}
              style={{ border: '1px solid var(--mt-border)' }}>取消</button>
            <button className="mt-btn active" onClick={handleAccept}
              style={{ fontWeight: 600, border: '1px solid var(--mt-accent)' }}>
              应用所选 ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
