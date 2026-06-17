/**
 * WritingWorkspace — M4: 全屏写作工作台
 *
 * Full-screen layout (no Palette/Inspector), Markdown rendering,
 * edit / preview / split modes, left source sidebar + right docs panel.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Markdown from '../common/Markdown';
import { useTextHistory } from '../../hooks/useTextHistory';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import { ENTITY_CONFIG, getGraphHops } from '../../types';
import type { EntityType } from '../../types';

type GenMode = 'scene' | 'outline' | 'continue';
type ViewMode = 'edit' | 'preview' | 'split';
type Length = 'short' | 'medium' | 'long';
type Pov = 'first' | 'third' | 'omniscient';
type Lang = 'zh' | 'en';

export default function WritingWorkspace() {
  const {
    entities, project, documents, selectedEntityId,
    loadDocuments, addDocument, removeDocument, updateDocument,
    setViewMode: setAppViewMode,
  } = useAppStore();
  const writingHop = getGraphHops(project).writing_context;
  const [mode, setMode] = useState<GenMode>('scene');
  const [editView, setEditView] = useState<ViewMode>('split');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sceneDesc, setSceneDesc] = useState('');
  // Generation controls
  const [length, setLength] = useState<Length>('medium');
  const [pov, setPov] = useState<Pov>('third');
  const [style, setStyle] = useState('');
  const [language, setLanguage] = useState<Lang>('zh');
  const gen = useTextHistory('');
  const generated = gen.value;
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

  // ── Source-selection helpers (Part D) ──
  const allIds = useMemo(() => entities.map((e) => e.id), [entities]);
  const selectAll = () => setSelectedIds(allIds);
  const clearAll = () => setSelectedIds([]);
  const toggleType = (t: EntityType) => {
    const ids = (entitiesByType[t] || []).map((e) => e.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allOn ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    );
  };
  // Pull the node currently selected in the main graph into the source list.
  const importFromGraph = () => {
    if (!selectedEntityId) return;
    setSelectedIds((prev) =>
      prev.includes(selectedEntityId) ? prev : [...prev, selectedEntityId]
    );
  };

  const handleGenerate = useCallback(async () => {
    if (!project) return;
    const isContinue = mode === 'continue';
    if (!isContinue && selectedIds.length === 0) return;
    if (isContinue && !gen.value.trim()) return;

    setStreaming(true);
    setViewingDocId(null);

    // Continue: keep existing prose and append; otherwise start fresh.
    const priorText = isContinue ? gen.value : '';
    genRef.current = isContinue ? gen.value + '\n\n' : '';
    if (!isContinue) gen.reset('');

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
          length, style, pov, language,
          prior_text: priorText,
        },
        (chunk) => {
          genRef.current += chunk;
          // Don't record each token — commit one history step when done.
          gen.set(genRef.current, { record: false });
        },
      );
      gen.commit();
    } catch (e: any) {
      gen.reset(`**错误**: ${e.message}`);
    }
    setStreaming(false);
  }, [project, selectedIds, mode, sceneDesc, length, style, pov, language, entities, gen]);

  const handleSave = async () => {
    if (!project || !generated) return;
    const autoTitle = mode === 'outline'
      ? '大纲'
      : `场景: ${selectedIds.map((id) => entities.find((e) => e.id === id)?.name).filter(Boolean).join(', ') || '未命名'}`;
    const title = prompt('文稿标题：', autoTitle);
    if (title === null) return; // user cancelled
    setSaving(true);
    await addDocument({
      title: title.trim() || autoTitle,
      kind: mode === 'outline' ? 'outline' : 'scene',
      content: generated,
      refs: { entity_ids: selectedIds },
    });
    setSaving(false);
    gen.reset('');
  };

  // Update the currently-viewed saved doc with edited content.
  const handleUpdateDoc = async () => {
    if (!viewingDocId) return;
    setSaving(true);
    await updateDocument(viewingDocId, { content: generated });
    setSaving(false);
  };

  // Rename a saved doc in place.
  const handleRename = async (doc: { id: string; title: string }) => {
    const title = prompt('重命名文稿：', doc.title);
    if (title === null || !title.trim() || title === doc.title) return;
    await updateDocument(doc.id, { title: title.trim() });
  };

  // Export content as a .md file (pure client-side).
  const exportMd = (title: string, content: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Saved documents
  const savedDocs = useMemo(() => {
    return documents.filter((d) => d.kind === mode || mode === 'scene' || mode === 'continue');
  }, [documents, mode]);

  const viewingDoc = viewingDocId ? documents.find((d) => d.id === viewingDocId) : null;
  // When viewing a saved doc, the editor edits a working copy (gen) seeded from it.
  const displayContent = generated || (viewingDoc ? viewingDoc.content : '');
  // True once the user has edited the viewed doc away from its stored content.
  const docDirty = !!viewingDoc && generated !== viewingDoc.content;

  // Generate button label + disabled state per mode.
  const genVerb = mode === 'outline' ? '生成大纲' : mode === 'continue' ? '续写' : '生成场景正文';
  const genDisabled = streaming || (mode === 'continue'
    ? !generated.trim()
    : selectedIds.length === 0);

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
          className={`mt-btn${mode === 'continue' ? ' active' : ''}`}
          onClick={() => setMode('continue')}
          style={{ fontSize: 11, padding: '3px 10px', border: `1px solid ${mode === 'continue' ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
          title="接着当前正文继续写"
        >
          ✍️ 续写
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
          disabled={genDisabled}
          style={{
            fontSize: 12, padding: '4px 14px', fontWeight: 600,
            border: '1px solid var(--mt-accent)',
            opacity: genDisabled && !streaming ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {streaming ? '⏳ 生成中...' : `✨ ${genVerb}`}
        </button>

        <div style={{ flex: 1 }} />

        {/* Undo / redo */}
        <button
          className="mt-btn"
          onClick={gen.undo}
          disabled={!gen.canUndo}
          title="撤销 (⌘/Ctrl+Z)"
          style={{ fontSize: 13, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
        >
          ↶
        </button>
        <button
          className="mt-btn"
          onClick={gen.redo}
          disabled={!gen.canRedo}
          title="重做 (⌘/Ctrl+Shift+Z)"
          style={{ fontSize: 13, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
        >
          ↷
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--mt-border-soft)' }} />

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
          {mode === 'continue' && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--mt-border-soft)', fontSize: 10, color: 'var(--mt-text-muted)', lineHeight: 1.5 }}>
              ✍️ 续写模式：将接着右侧编辑器中的正文继续写。请确保编辑区已有内容。
            </div>
          )}

          {/* Generation parameters */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--mt-border-soft)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mode !== 'outline' && (
              <>
                <Segmented
                  label="篇幅"
                  value={length}
                  options={[['short', '短'], ['medium', '中'], ['long', '长']]}
                  onChange={(v) => setLength(v as Length)}
                />
                <Segmented
                  label="视角"
                  value={pov}
                  options={[['first', '第一'], ['third', '第三'], ['omniscient', '全知']]}
                  onChange={(v) => setPov(v as Pov)}
                />
              </>
            )}
            <Segmented
              label="语言"
              value={language}
              options={[['zh', '中文'], ['en', 'EN']]}
              onChange={(v) => setLanguage(v as Lang)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--mt-text-muted)', width: 28, flexShrink: 0 }}>文风</span>
              <input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="如：冷峻克制"
                style={{
                  flex: 1, fontSize: 11, padding: '3px 6px',
                  background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                  borderRadius: 4, color: 'var(--mt-text)', outline: 'none', minWidth: 0,
                }}
              />
            </div>
          </div>

          {/* Source quick actions */}
          {mode !== 'continue' && (
            <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--mt-border-soft)', flexWrap: 'wrap' }}>
              <button className="mt-btn" onClick={importFromGraph} disabled={!selectedEntityId}
                title={selectedEntityId ? '把主图中选中的节点加入来源' : '主图未选中节点'}
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--mt-border)', opacity: selectedEntityId ? 1 : 0.5 }}>
                ⤵ 从主图带入
              </button>
              <button className="mt-btn" onClick={selectAll}
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--mt-border)' }}>
                全选
              </button>
              <button className="mt-btn" onClick={clearAll}
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--mt-border)' }}>
                清空
              </button>
            </div>
          )}

          {/* Entity list grouped by type */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            <div style={{ padding: '2px 12px 6px', fontSize: 10, color: 'var(--mt-text-muted)' }}>
              选择参与实体（{writingHop}-hop 上下文将自动注入）
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
                    <span style={{ flex: 1 }} />
                    <span
                      onClick={() => toggleType(t)}
                      title="全选 / 清空该类型"
                      style={{ fontSize: 9, fontWeight: 500, color: 'var(--mt-text-muted)', cursor: 'pointer' }}
                    >
                      {list.every((e) => selectedIds.includes(e.id)) ? '清空' : '全选'}
                    </span>
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
              disabled={genDisabled}
              style={{
                width: '100%', fontWeight: 600, fontSize: 12,
                border: '1px solid var(--mt-accent)',
                opacity: genDisabled && !streaming ? 0.5 : 1,
                justifyContent: 'center',
              }}
            >
              {streaming ? '⏳ 生成中...' : `✨ ${genVerb}`}
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
                <span style={{ fontSize: 12 }}>{writingHop}-hop 图谱上下文将自动注入到 Prompt 中</span>
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
                    onChange={(e) => gen.set(e.target.value)}
                    onKeyDown={gen.onKeyDown}
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
                    <Markdown>{displayContent}</Markdown>
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
                      gen.reset('');
                    } else {
                      setViewingDocId(doc.id);
                      gen.reset(doc.content);
                    }
                  }}
                  onDoubleClick={(e) => { e.stopPropagation(); handleRename(doc); }}
                  title="单击查看/编辑，双击重命名"
                  style={{
                    position: 'relative',
                    padding: '8px 10px', marginBottom: 4, borderRadius: 4,
                    border: `1px solid ${viewingDocId === doc.id ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
                    cursor: 'pointer',
                    background: viewingDocId === doc.id ? 'var(--mt-accent)11' : '#fff',
                  }}
                >
                  {/* Card actions */}
                  <span style={{ position: 'absolute', top: 4, right: 6, display: 'flex', gap: 6 }}>
                    <span
                      onClick={(e) => { e.stopPropagation(); exportMd(doc.title, doc.content); }}
                      title="导出 .md"
                      style={{ fontSize: 11, lineHeight: 1, color: '#bbb', cursor: 'pointer' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = 'var(--mt-accent)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#bbb'; }}
                    >
                      ⬇
                    </span>
                    <span
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`删除文稿「${doc.title}」？`)) return;
                        await removeDocument(doc.id);
                        if (viewingDocId === doc.id) { setViewingDocId(null); gen.reset(''); }
                      }}
                      title="删除文稿"
                      style={{ fontSize: 11, lineHeight: 1, color: '#ccc', cursor: 'pointer' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#c0392b'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#ccc'; }}
                    >
                      ✕
                    </span>
                  </span>
                  <div style={{ fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 32 }}>
                    {doc.kind === 'outline' ? '📋' : '🎬'} {doc.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginTop: 2 }}>
                    {doc.content.length} 字
                  </div>
                  {/* Mini MD preview */}
                  <Markdown
                    style={{ fontSize: 10, color: 'var(--mt-text-muted)', maxHeight: 60, overflow: 'hidden', marginTop: 4, lineHeight: 1.4 }}
                  >
                    {doc.content.slice(0, 200)}
                  </Markdown>
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
      {generated && !streaming && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px', borderTop: '1px solid var(--mt-border)',
          background: 'var(--mt-panel)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: 'var(--mt-text-muted)' }}>
            {generated.length} 字{viewingDoc ? `　·　正在编辑「${viewingDoc.title}」${docDirty ? '（未保存）' : ''}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="mt-btn"
              onClick={() => exportMd(viewingDoc?.title || 'document', generated)}
              style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--mt-border)' }}
            >
              ⬇ 导出 .md
            </button>
            <button
              className="mt-btn"
              onClick={() => { gen.reset(''); setViewingDocId(null); }}
              style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--mt-border)' }}
            >
              {viewingDoc ? '关闭' : '清空'}
            </button>
            {viewingDoc ? (
              <button
                className="mt-btn active"
                onClick={handleUpdateDoc}
                disabled={saving || !docDirty}
                style={{ fontSize: 12, padding: '4px 16px', fontWeight: 600, border: '1px solid var(--mt-accent)', opacity: !docDirty ? 0.5 : 1 }}
              >
                {saving ? '更新中...' : '💾 更新文稿'}
              </button>
            ) : (
              <button
                className="mt-btn active"
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize: 12, padding: '4px 16px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
              >
                {saving ? '保存中...' : '💾 保存文稿'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small segmented control for generation params ──
function Segmented({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, color: 'var(--mt-text-muted)', width: 28, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', flex: 1, border: '1px solid var(--mt-border)', borderRadius: 4, overflow: 'hidden' }}>
        {options.map(([key, lbl]) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              flex: 1, fontSize: 10, padding: '3px 0', border: 'none', cursor: 'pointer',
              background: value === key ? 'var(--mt-accent)' : 'transparent',
              color: value === key ? '#fff' : 'var(--mt-text-muted)',
              fontWeight: value === key ? 600 : 400,
            }}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}
