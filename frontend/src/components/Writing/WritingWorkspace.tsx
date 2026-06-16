/**
 * WritingWorkspace — M4: 全屏写作工作台
 *
 * Full-screen layout (no Palette/Inspector), Markdown rendering,
 * edit / preview / split modes, collapsible saved docs panel.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import { ENTITY_CONFIG } from '../../types';
import type { EntityType } from '../../types';

type GenMode = 'scene' | 'outline';
type ViewMode = 'edit' | 'preview' | 'split';

export default function WritingWorkspace() {
  const { entities, project, documents, loadDocuments, addDocument, viewMode: appViewMode, setViewMode: setAppViewMode } = useAppStore();
  const [mode, setMode] = useState<GenMode>('scene');
  const [editView, setEditView] = useState<ViewMode>('split');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sceneDesc, setSceneDesc] = useState('');
  const [generated, setGenerated] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showEntityPicker, setShowEntityPicker] = useState(false);
  const [showDocs, setShowDocs] = useState(true);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
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
      setGenerated(`**错误**: ${e.message}`);
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

  // Saved documents
  const savedDocs = useMemo(() => {
    return documents.filter((d) => d.kind === mode || mode === 'scene');
  }, [documents, mode]);

  const viewingDoc = viewingDocId ? documents.find((d) => d.id === viewingDocId) : null;

  // The content to display (generated or viewing doc)
  const displayContent = viewingDoc ? viewingDoc.content : generated;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: 'var(--mt-text)', background: 'var(--mt-window)',
    }}>
      {/* ── Top toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 16px', borderBottom: '1px solid var(--mt-border)',
        background: 'var(--mt-panel)', flexShrink: 0,
      }}>
        {/* Back to graph */}
        <button
          className="mt-btn"
          onClick={() => setAppViewMode('relations')}
          style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
          title="返回关系图"
        >
          ← 关系图
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--mt-border-soft)' }} />

        {/* Mode switch */}
        <button
          className={`mt-btn${mode === 'scene' ? ' active' : ''}`}
          onClick={() => setMode('scene')}
          style={{ fontSize: 11, padding: '3px 10px', border: `1px solid ${mode === 'scene' ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
        >
          🎬 场景
        </button>
        <button
          className={`mt-btn${mode === 'outline' ? ' active' : ''}`}
          onClick={() => setMode('outline')}
          style={{ fontSize: 11, padding: '3px 10px', border: `1px solid ${mode === 'outline' ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
        >
          📋 大纲
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--mt-border-soft)' }} />

        {/* Entity picker toggle */}
        <div style={{ position: 'relative' }}>
          <button
            className="mt-btn"
            onClick={() => setShowEntityPicker((v) => !v)}
            style={{ fontSize: 11, padding: '3px 10px', border: `1px solid ${selectedIds.length > 0 ? 'var(--mt-accent)' : 'var(--mt-border)'}`, background: selectedIds.length > 0 ? 'var(--mt-accent)11' : undefined }}
          >
            📚 来源 ({selectedIds.length})
          </button>
          {showEntityPicker && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 200,
              background: '#fff', border: '1px solid var(--mt-border)',
              borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              width: 280, maxHeight: 400, overflowY: 'auto',
              marginTop: 4,
            }}
              onMouseLeave={() => setShowEntityPicker(false)}
            >
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--mt-border-soft)', fontWeight: 600, fontSize: 12 }}>
                选择参与实体
                <span style={{ fontWeight: 400, color: 'var(--mt-text-muted)', marginLeft: 4 }}>2-hop 上下文自动注入</span>
              </div>
              {selectableEntities.map((e) => (
                <div
                  key={e.id}
                  onClick={() => handleSelect(e.id)}
                  style={{
                    padding: '6px 12px', fontSize: 12, cursor: 'pointer',
                    background: selectedIds.includes(e.id) ? `${e.color}15` : 'transparent',
                    borderLeft: selectedIds.includes(e.id) ? `3px solid ${e.color}` : '3px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={(ev) => { if (!selectedIds.includes(e.id)) (ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
                  onMouseLeave={(ev) => { if (!selectedIds.includes(e.id)) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <span>{e.icon}</span>
                  <span style={{ flex: 1 }}>{e.name}</span>
                  {selectedIds.includes(e.id) && <span style={{ fontSize: 10, color: e.color, fontWeight: 700 }}>✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scene description (scene mode) */}
        {mode === 'scene' && (
          <input
            value={sceneDesc}
            onChange={(e) => setSceneDesc(e.target.value)}
            placeholder="描述场景（如：鸿门宴上裴青玄试探李长安）..."
            style={{
              flex: 1, minWidth: 120, fontSize: 12, padding: '4px 10px',
              background: '#fff', border: '1px solid var(--mt-border)',
              borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
            }}
          />
        )}

        {/* Generate button */}
        <button
          className="mt-btn active"
          onClick={handleGenerate}
          disabled={streaming || selectedIds.length === 0}
          style={{
            fontSize: 12, padding: '4px 14px', fontWeight: 600,
            border: '1px solid var(--mt-accent)',
            opacity: selectedIds.length === 0 ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {streaming ? '⏳ 生成中...' : `✨ 生成${mode === 'scene' ? '场景正文' : '大纲'}`}
        </button>

        <div style={{ flex: 1 }} />

        {/* Edit/Preview/Split toggle */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--mt-border)', borderRadius: 4, overflow: 'hidden' }}>
          {([['edit', '编辑'], ['preview', '预览'], ['split', '分栏']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setEditView(key)}
              style={{
                fontSize: 11, padding: '3px 10px', border: 'none', cursor: 'pointer',
                background: editView === key ? 'var(--mt-accent)' : 'transparent',
                color: editView === key ? '#fff' : 'var(--mt-text-muted)',
                fontWeight: editView === key ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Saved docs toggle */}
        <button
          className="mt-btn"
          onClick={() => setShowDocs((v) => !v)}
          style={{ fontSize: 11, padding: '3px 8px', border: `1px solid ${showDocs ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
        >
          📄 存稿
        </button>

        {/* Settings */}
        <button
          className="mt-btn"
          onClick={() => useAppStore.getState().setSettingsOpen(true)}
          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--mt-border)' }}
        >
          ⚙️
        </button>
      </div>

      {/* ── Main content area ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Editor / Preview area */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          {/* Empty state */}
          {!displayContent && !streaming && !viewingDoc && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--mt-text-muted)', fontSize: 15,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✍️</div>
                选择来源实体，点击「生成」开始创作<br />
                <span style={{ fontSize: 12 }}>2-hop 图谱上下文将自动注入到 Prompt 中</span>
              </div>
            </div>
          )}

          {/* Streaming indicator */}
          {streaming && !generated && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mt-accent)', fontSize: 14 }}>
              ⏳ 正在生成...
            </div>
          )}

          {/* Edit + Preview panels */}
          {(displayContent || streaming) && (
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Edit pane */}
              {(editView === 'edit' || editView === 'split') && (
                <div style={{
                  flex: editView === 'split' ? 1 : undefined, width: editView === 'edit' ? '100%' : undefined,
                  display: 'flex', flexDirection: 'column', minHeight: 0,
                  borderRight: editView === 'split' ? '1px solid var(--mt-border)' : 'none',
                }}>
                  {editView === 'split' && (
                    <div style={{
                      padding: '4px 12px', fontSize: 10, fontWeight: 600,
                      color: 'var(--mt-text-muted)', background: 'var(--mt-panel-header)',
                      borderBottom: '1px solid var(--mt-border-soft)',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>
                      Markdown 源码
                    </div>
                  )}
                  <textarea
                    value={generated}
                    onChange={(e) => setGenerated(e.target.value)}
                    readOnly={!!viewingDoc}
                    style={{
                      flex: 1, resize: 'none', border: 'none', outline: 'none',
                      fontSize: 15, lineHeight: 1.8, padding: 20,
                      background: '#fff', color: 'var(--mt-text)',
                      fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace',
                    }}
                  />
                </div>
              )}

              {/* Preview pane */}
              {(editView === 'preview' || editView === 'split') && (
                <div style={{
                  flex: editView === 'split' ? 1 : undefined, width: editView === 'preview' ? '100%' : undefined,
                  display: 'flex', flexDirection: 'column', minHeight: 0,
                }}>
                  {editView === 'split' && (
                    <div style={{
                      padding: '4px 12px', fontSize: 10, fontWeight: 600,
                      color: 'var(--mt-text-muted)', background: 'var(--mt-panel-header)',
                      borderBottom: '1px solid var(--mt-border-soft)',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>
                      预览
                    </div>
                  )}
                  <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#fff' }}>
                    <div className="md-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {displayContent || ''}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Saved documents panel ── */}
        {showDocs && (
          <div style={{
            width: 260, borderLeft: '1px solid var(--mt-border)',
            background: 'var(--mt-panel)', display: 'flex', flexDirection: 'column',
            flexShrink: 0,
          }}>
            <div style={{
              padding: '8px 14px', borderBottom: '1px solid var(--mt-border)',
              fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              📄 已存文稿
              <span style={{ fontWeight: 400, color: 'var(--mt-text-muted)', fontSize: 10 }}>({savedDocs.length})</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
              {savedDocs.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => {
                    if (viewingDocId === doc.id) {
                      setViewingDocId(null);
                      setGenerated('');
                    } else {
                      setViewingDocId(doc.id);
                      setGenerated(doc.content);
                    }
                  }}
                  style={{
                    padding: '8px 10px', marginBottom: 4, borderRadius: 4,
                    border: `1px solid ${viewingDocId === doc.id ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
                    cursor: 'pointer',
                    background: viewingDocId === doc.id ? 'var(--mt-accent)11' : '#fff',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.kind === 'scene' ? '🎬' : '📋'} {doc.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginTop: 2 }}>
                    {doc.content.length} 字
                  </div>
                  {/* Mini MD preview */}
                  <div className="md-body" style={{ fontSize: 10, color: 'var(--mt-text-muted)', maxHeight: 60, overflow: 'hidden', marginTop: 4, lineHeight: 1.4 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {doc.content.slice(0, 200)}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
              {savedDocs.length === 0 && (
                <div style={{ color: 'var(--mt-text-muted)', fontSize: 12, textAlign: 'center', padding: 24 }}>
                  暂无存稿
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom save bar ── */}
      {generated && !streaming && !viewingDoc && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px', borderTop: '1px solid var(--mt-border)',
          background: 'var(--mt-panel)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: 'var(--mt-text-muted)' }}>
            {generated.length} 字
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="mt-btn"
              onClick={() => { setGenerated(''); setViewingDocId(null); }}
              style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--mt-border)' }}
            >
              清空
            </button>
            <button
              className="mt-btn active"
              onClick={handleSave}
              disabled={saving}
              style={{ fontSize: 12, padding: '4px 16px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
            >
              {saving ? '保存中...' : '💾 保存文稿'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
