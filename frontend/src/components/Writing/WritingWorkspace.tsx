/**
 * WritingWorkspace — M4: 全屏写作工作台
 *
 * Full-screen layout (no Palette/Inspector), Markdown rendering,
 * edit / preview / split modes, left source sidebar + right docs panel.
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
  const { entities, project, documents, loadDocuments, addDocument, setViewMode: setAppViewMode } = useAppStore();
  const [mode, setMode] = useState<GenMode>('scene');
  const [editView, setEditView] = useState<ViewMode>('split');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sceneDesc, setSceneDesc] = useState('');
  const [generated, setGenerated] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDocs, setShowDocs] = useState(true);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const genRef = useRef('');

  // Load documents on mount
  useEffect(() => { loadDocuments(); }, []);

  // Group entities by type for the sidebar
  const entitiesByType = useMemo(() => {
    const groups: Record<string, { id: string; name: string; icon: string; color: string }[]> = {};
    for (const e of entities) {
      const t = e.type || 'character';
      if (!groups[t]) groups[t] = [];
      groups[t].push({
        id: e.id,
        name: e.name,
        icon: ENTITY_CONFIG[e.type as EntityType]?.icon || '❓',
        color: ENTITY_CONFIG[e.type as EntityType]?.color || '#888',
      });
    }
    return groups;
  }, [entities]);

  const typeOrder: EntityType[] = ['character', 'faction', 'event', 'location', 'item'];

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

        {/* ── Left: Source sidebar ── */}
        <div style={{
          width: 240, borderRight: '1px solid var(--mt-border)',
          background: 'var(--mt-panel)', display: 'flex', flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--mt-border)',
            fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            📚 来源选择
            {selectedIds.length > 0 && (
              <span style={{
                fontWeight: 400, fontSize: 10, color: '#fff',
                background: 'var(--mt-accent)', borderRadius: 8,
                padding: '0 6px', lineHeight: '16px',
              }}>
                {selectedIds.length}
              </span>
            )}
          </div>

          {/* Scene description */}
          {mode === 'scene' && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--mt-border-soft)' }}>
              <textarea
                value={sceneDesc}
                onChange={(e) => setSceneDesc(e.target.value)}
                placeholder="描述场景（如：鸿门宴上裴青玄试探李长安）..."
                rows={3}
                style={{
                  width: '100%', resize: 'none', fontSize: 12, padding: '6px 8px',
                  background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                  borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
                  lineHeight: 1.5,
                }}
              />
            </div>
          )}

          {/* Entity list grouped by type */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            <div style={{ padding: '2px 12px 6px', fontSize: 10, color: 'var(--mt-text-muted)' }}>
              选择参与实体（2-hop 上下文将自动注入）
            </div>
            {typeOrder.map((t) => {
              const list = entitiesByType[t];
              if (!list || list.length === 0) return null;
              const cfg = ENTITY_CONFIG[t];
              return (
                <div key={t}>
                  <div style={{
                    padding: '4px 12px', fontSize: 10, fontWeight: 700,
                    color: cfg.color, display: 'flex', alignItems: 'center', gap: 4,
                    borderTop: '1px solid var(--mt-border-soft)',
                    background: 'rgba(255,255,255,0.5)',
                  }}>
                    {cfg.icon} {cfg.label}
                  </div>
                  {list.map((e) => {
                    const on = selectedIds.includes(e.id);
                    return (
                      <div
                        key={e.id}
                        onClick={() => handleSelect(e.id)}
                        style={{
                          padding: '4px 12px 4px 24px', fontSize: 12, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6,
                          background: on ? `${e.color}12` : 'transparent',
                          borderLeft: on ? `3px solid ${e.color}` : '3px solid transparent',
                        }}
                        onMouseEnter={(ev) => { if (!on) (ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
                        onMouseLeave={(ev) => { if (!on) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.name}
                        </span>
                        {on && <span style={{ fontSize: 10, color: e.color, fontWeight: 700, flexShrink: 0 }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Generate button at bottom */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--mt-border)' }}>
            <button
              className="mt-btn active"
              onClick={handleGenerate}
              disabled={streaming || selectedIds.length === 0}
              style={{
                width: '100%', fontWeight: 600, fontSize: 12,
                border: '1px solid var(--mt-accent)',
                opacity: selectedIds.length === 0 ? 0.5 : 1,
                justifyContent: 'center',
              }}
            >
              {streaming ? '⏳ 生成中...' : `✨ 生成${mode === 'scene' ? '场景正文' : '大纲'}`}
            </button>
          </div>
        </div>

        {/* ── Center: Editor / Preview ── */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          {/* Empty state */}
          {!displayContent && !streaming && !viewingDoc && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--mt-text-muted)', fontSize: 15,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✍️</div>
                从左侧选择来源实体，点击「生成」开始创作<br />
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
