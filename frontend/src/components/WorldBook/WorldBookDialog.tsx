import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import { ImeInput, ImeTextarea } from '../common/ImeInput';
import { downloadJson, pickJsonFile } from '../../utils/fileIo';

interface WorldBookDialogProps {
  open: boolean;
  onClose: () => void;
}

type WorldEntry = {
  id: string;
  title: string;
  content: string;
  scope: string;            // global | entity
  entity_ids: string[];
  keys: string[];
  priority: number;
  enabled: number;
  properties: Record<string, unknown>;
};

/**
 * World Book (世界书) editor — markdown lore entries that get hard-injected into
 * LLM context. Global entries are always on; entity-scoped entries fire only
 * when an attached entity is in scene (see backend app/graph/worldbook.py).
 */
export default function WorldBookDialog({ open, onClose }: WorldBookDialogProps) {
  const { project, entities } = useAppStore();
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const list = await api.listWorldEntries(project.id);
      setEntries(list);
      setSelectedId((prev) => prev && list.some((e: WorldEntry) => e.id === prev) ? prev : (list[0]?.id ?? null));
    } catch (e) {
      console.error('Failed to load world entries:', e);
    }
    setLoading(false);
  }, [project]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open || !project) return null;

  const selected = entries.find((e) => e.id === selectedId) || null;

  const handleCreate = async () => {
    const created = await api.createWorldEntry(project.id, {
      title: '新词条', content: '', scope: 'global', priority: 0, enabled: 1,
    });
    setEntries((prev) => [...prev, created]);
    setSelectedId(created.id);
  };

  const patch = (data: Partial<WorldEntry>) => {
    if (!selected) return;
    setEntries((prev) => prev.map((e) => (e.id === selected.id ? { ...e, ...data } : e)));
  };

  // Persist the current selected entry (debounced-on-blur via commit handlers).
  const save = async (data: Partial<WorldEntry>) => {
    if (!selected) return;
    patch(data);
    try {
      await api.updateWorldEntry(project.id, selected.id, data);
    } catch (e) {
      console.error('Failed to save world entry:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('删除此词条？')) return;
    await api.deleteWorldEntry(project.id, id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleExport = async () => {
    if (!project) return;
    try {
      const data = await api.exportWorldEntries(project.id);
      downloadJson(`${project.name}-worldbook`, data);
    } catch (e) {
      console.error('Failed to export world book:', e);
      alert('导出失败：' + (e as Error).message);
    }
  };

  const handleImport = async () => {
    if (!project) return;
    try {
      const payload = await pickJsonFile();
      if (payload == null) return;
      const created = await api.importWorldEntries(project.id, payload);
      await load();
      if (created[0]) setSelectedId(created[0].id);
      alert(`已导入 ${created.length} 条词条到当前项目。`);
    } catch (e) {
      console.error('Failed to import world book:', e);
      alert('导入失败：' + (e as Error).message);
    }
  };

  const toggleEntity = (eid: string) => {
    if (!selected) return;
    const cur = selected.entity_ids || [];
    const next = cur.includes(eid) ? cur.filter((x) => x !== eid) : [...cur, eid];
    save({ entity_ids: next });
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', background: '#fff', border: '1px solid var(--mt-border)',
    borderRadius: 4, padding: '6px 8px', color: 'var(--mt-text)', fontSize: 13, outline: 'none',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--mt-panel)', borderRadius: 8, border: '1px solid var(--mt-border)',
          width: 'min(880px, 94vw)', height: 'min(620px, 90vh)', display: 'flex', flexDirection: 'column',
          boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: 'var(--mt-text)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--mt-border)', fontWeight: 600, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📖 世界书 World Book</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="mt-btn" onClick={handleImport} title="导入 SillyTavern 世界书 或 原生导出（追加到当前项目）" style={{ fontSize: 12, padding: '2px 10px', border: '1px solid var(--mt-border)' }}>⬆ 导入</button>
            <button className="mt-btn" onClick={handleExport} title="导出当前项目全部词条为 JSON" style={{ fontSize: 12, padding: '2px 10px', border: '1px solid var(--mt-border)' }}>⬇ 导出</button>
            <button className="mt-btn" onClick={onClose} style={{ fontSize: 12, padding: '2px 10px', border: '1px solid var(--mt-border)' }}>关闭</button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* ── entry list ── */}
          <div style={{ width: 240, flex: '0 0 240px', borderRight: '1px solid var(--mt-border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 8, borderBottom: '1px solid var(--mt-border-soft)' }}>
              <button className="mt-btn active" onClick={handleCreate} style={{ width: '100%', fontSize: 12, padding: '5px 0', border: '1px solid var(--mt-accent)' }}>＋ 新建词条</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--mt-text-faint)' }}>加载中…</div>}
              {!loading && entries.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--mt-text-faint)' }}>（暂无词条）</div>
              )}
              {entries.map((e) => {
                const active = e.id === selectedId;
                return (
                  <div
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    style={{
                      padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--mt-border-soft)',
                      background: active ? 'var(--mt-sel-fill)' : 'transparent',
                      borderLeft: `3px solid ${active ? 'var(--mt-accent)' : 'transparent'}`,
                      opacity: e.enabled ? 1 : 0.5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 11 }}>{e.scope === 'global' ? '🌐' : '📌'}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{e.title || '（无标题）'}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--mt-text-faint)', marginTop: 2 }}>
                      {e.scope === 'global' ? '全局常驻' : `挂载 ${e.entity_ids?.length || 0} 实体`} · 优先级 {e.priority}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── editor ── */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 16 }}>
            {!selected && <div style={{ fontSize: 13, color: 'var(--mt-text-faint)' }}>选择或新建一个词条进行编辑。</div>}
            {selected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label>
                  <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>标题</span>
                  <ImeInput value={selected.title} onCommit={(v) => save({ title: v })} style={fieldStyle} />
                </label>

                <div style={{ display: 'flex', gap: 12 }}>
                  <label style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>作用域</span>
                    <select
                      value={selected.scope}
                      onChange={(e) => save({ scope: e.target.value })}
                      style={{ ...fieldStyle, padding: '6px 6px' }}
                    >
                      <option value="global">🌐 全局常驻（恒注入）</option>
                      <option value="entity">📌 挂载实体（在场时注入）</option>
                    </select>
                  </label>
                  <label style={{ flex: '0 0 110px' }}>
                    <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>优先级</span>
                    <input
                      type="number"
                      value={selected.priority}
                      onChange={(e) => save({ priority: parseInt(e.target.value, 10) || 0 })}
                      style={fieldStyle}
                    />
                  </label>
                  <label style={{ flex: '0 0 90px', display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>启用</span>
                    <button
                      className={`mt-btn${selected.enabled ? ' active' : ''}`}
                      onClick={() => save({ enabled: selected.enabled ? 0 : 1 })}
                      style={{ padding: '6px 0', border: `1px solid ${selected.enabled ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
                    >
                      {selected.enabled ? '✓ 启用' : '✕ 停用'}
                    </button>
                  </label>
                </div>

                {selected.scope === 'entity' && (
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
                      挂载到实体（任一在场即注入）
                    </span>
                    <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--mt-border-soft)', borderRadius: 4, background: '#fff', padding: 6 }}>
                      {entities.length === 0 && <div style={{ fontSize: 11, color: 'var(--mt-text-faint)' }}>（无实体）</div>}
                      {entities.map((e) => {
                        const checked = (selected.entity_ids || []).includes(e.id);
                        return (
                          <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 2px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleEntity(e.id)} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <label>
                  <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>内容（markdown）</span>
                  <ImeTextarea value={selected.content} onCommit={(v) => save({ content: v })} rows={12} style={{ ...fieldStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6 }} />
                </label>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="mt-btn" onClick={() => handleDelete(selected.id)} style={{ fontSize: 12, padding: '4px 12px', border: '1px solid var(--mt-border)', color: '#c0392b' }}>🗑️ 删除词条</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
