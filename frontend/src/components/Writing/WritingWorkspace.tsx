/**
 * WritingWorkspace — M4: 文本生成工作台
 *
 * Three modes: scene prose / per-event draft / outline.
 * Uses graph context (2-hop) + streaming generation (M2b).
 * Documents persisted via Document API.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import { ENTITY_CONFIG } from '../../types';
import type { EntityType } from '../../types';

type GenMode = 'scene' | 'outline';

export default function WritingWorkspace() {
  const { entities, relations, project, documents, loadDocuments, addDocument } = useAppStore();
  const [mode, setMode] = useState<GenMode>('scene');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sceneDesc, setSceneDesc] = useState('');
  const [generated, setGenerated] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const genRef = useRef('');

  // Load documents on mount
  useEffect(() => { loadDocuments(); }, []);

  // Entity selector options
  const selectableEntities = useMemo(() => {
    return entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      icon: ENTITY_CONFIG[e.type as EntityType]?.icon || '❓',
      color: ENTITY_CONFIG[e.type as EntityType]?.color || '#888',
    }));
  }, [entities]);

  const handleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleGenerate = useCallback(async () => {
    if (!project || selectedIds.length === 0) return;
    setStreaming(true);
    setGenerated('');
    genRef.current = '';

    try {
      await api.generateStream(
        project.id,
        {
          mode,
          context_entity_ids: selectedIds,
          context_event_ids: selectedIds.filter((id) =>
            entities.find((e) => e.id === id && e.type === 'event')
          ),
          scene_description: sceneDesc,
        },
        (chunk) => {
          genRef.current += chunk;
          setGenerated(genRef.current);
        },
      );
    } catch (e: any) {
      setGenerated(`错误: ${e.message}`);
    }
    setStreaming(false);
  }, [project, selectedIds, mode, sceneDesc, entities]);

  const handleSave = async () => {
    if (!project || !generated) return;
    setSaving(true);
    const title = mode === 'scene'
      ? `场景: ${selectedIds.map((id) => entities.find((e) => e.id === id)?.name).filter(Boolean).join(', ')}`
      : `大纲`;
    await addDocument({
      title,
      kind: mode === 'scene' ? 'scene' : 'outline',
      content: generated,
      refs: { entity_ids: selectedIds },
    });
    setSaving(false);
    setGenerated('');
  };

  // Saved documents for this project
  const savedDocs = useMemo(() => {
    return documents.filter((d) => d.kind === mode || mode === 'scene');
  }, [documents, mode]);

  return (
    <div style={{
      display: 'flex', height: '100%', gap: 0,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: 'var(--mt-text)', background: 'var(--mt-window)',
    }}>
      {/* Left: Source selector */}
      <div style={{
        width: 220, borderRight: '1px solid var(--mt-border)',
        background: 'var(--mt-panel)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--mt-border)', fontWeight: 600, fontSize: 12 }}>
          📚 来源选择
        </div>

        {/* Mode switch */}
        <div style={{ padding: '8px 14px', display: 'flex', gap: 4 }}>
          <button
            className={`mt-btn${mode === 'scene' ? ' active' : ''}`}
            onClick={() => setMode('scene')}
            style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--mt-border)' }}
          >
            🎬 场景
          </button>
          <button
            className={`mt-btn${mode === 'outline' ? ' active' : ''}`}
            onClick={() => setMode('outline')}
            style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--mt-border)' }}
          >
            📋 大纲
          </button>
        </div>

        {/* Scene description (scene mode only) */}
        {mode === 'scene' && (
          <div style={{ padding: '8px 14px' }}>
            <textarea
              value={sceneDesc}
              onChange={(e) => setSceneDesc(e.target.value)}
              placeholder="描述场景（如：鸿门宴上裴青玄试探李长安）..."
              rows={3}
              style={{
                width: '100%', resize: 'none', fontSize: 11, padding: '6px 8px',
                background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
              }}
            />
          </div>
        )}

        {/* Entity list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 14px' }}>
          <div style={{ fontSize: 9, color: 'var(--mt-text-muted)', marginBottom: 4 }}>
            选择参与实体（2-hop 上下文将自动注入）
          </div>
          {selectableEntities.map((e) => (
            <div
              key={e.id}
              onClick={() => handleSelect(e.id)}
              style={{
                padding: '4px 6px', fontSize: 11, cursor: 'pointer', borderRadius: 3,
                background: selectedIds.includes(e.id) ? `${e.color}22` : 'transparent',
                borderLeft: selectedIds.includes(e.id) ? `2px solid ${e.color}` : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span>{e.icon}</span>
              <span>{e.name}</span>
              {selectedIds.includes(e.id) && <span style={{ fontSize: 9, color: e.color }}>✓</span>}
            </div>
          ))}
        </div>

        {/* Generate button */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--mt-border)' }}>
          <button
            className="mt-btn active"
            onClick={handleGenerate}
            disabled={streaming || selectedIds.length === 0}
            style={{
              width: '100%', fontWeight: 600, fontSize: 12,
              border: '1px solid var(--mt-accent)',
              opacity: selectedIds.length === 0 ? 0.5 : 1,
            }}
          >
            {streaming ? '⏳ 生成中...' : `✨ 生成${mode === 'scene' ? '场景正文' : '大纲'}`}
          </button>
        </div>
      </div>

      {/* Center: Generated content editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          padding: '8px 16px', borderBottom: '1px solid var(--mt-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--mt-panel-header)',
        }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {mode === 'scene' ? '🎬 场景正文' : '📋 故事大纲'}
          </span>
          {generated && !streaming && (
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--mt-text-muted)' }}>{generated.length} 字</span>
              <button
                className="mt-btn active"
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize: 10, padding: '2px 10px', border: '1px solid var(--mt-accent)' }}
              >
                {saving ? '保存中...' : '💾 保存'}
              </button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
          {!generated && !streaming && (
            <div style={{ textAlign: 'center', color: 'var(--mt-text-muted)', fontSize: 13, padding: 40 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✍️</div>
              选择左侧实体，点击「生成」开始创作<br />
              <span style={{ fontSize: 11 }}>2-hop 图谱上下文将自动注入到 Prompt 中</span>
            </div>
          )}
          {streaming && !generated && (
            <div style={{ textAlign: 'center', color: 'var(--mt-accent)', fontSize: 13 }}>
              ⏳ 正在生成...
            </div>
          )}
          {(generated || streaming) && (
            <textarea
              value={generated}
              onChange={(e) => setGenerated(e.target.value)}
              style={{
                width: '100%', minHeight: '100%', resize: 'none',
                fontSize: 14, lineHeight: 1.8, padding: 0,
                background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--mt-text)', fontFamily: 'inherit',
              }}
            />
          )}
        </div>
      </div>

      {/* Right: Saved documents */}
      <div style={{
        width: 200, borderLeft: '1px solid var(--mt-border)',
        background: 'var(--mt-panel)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--mt-border)', fontWeight: 600, fontSize: 12 }}>
          📄 已存文稿 ({savedDocs.length})
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px' }}>
          {savedDocs.map((doc) => (
            <div
              key={doc.id}
              style={{
                padding: '6px 8px', marginBottom: 4, borderRadius: 3,
                border: '1px solid var(--mt-border)', cursor: 'pointer',
              }}
              onClick={() => setGenerated(doc.content)}
            >
              <div style={{ fontWeight: 500, fontSize: 12 }}>{doc.title}</div>
              <div style={{ fontSize: 10, color: 'var(--mt-text-muted)' }}>
                {doc.kind === 'scene' ? '🎬' : '📋'} {doc.content.length} 字
              </div>
            </div>
          ))}
          {savedDocs.length === 0 && (
            <div style={{ color: 'var(--mt-text-muted)', fontSize: 11, textAlign: 'center', padding: 20 }}>
              暂无存稿
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
