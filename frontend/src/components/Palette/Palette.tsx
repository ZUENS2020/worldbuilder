import { useState, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, PALETTE_CATEGORIES } from '../../types';
import type { EntityType } from '../../types';

export const DND_MIME = 'application/worldbuilder-entity-type';

export default function Palette() {
  const {
    addEntity, project, entities, setSelectedEntity, selectedEntityId,
    createOpen, setCreateOpen,
  } = useAppStore();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EntityType>('character');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const handleCreate = async () => {
    if (!newName.trim() || !project) return;
    await addEntity({ name: newName.trim(), type: newType });
    setNewName('');
    setCreateOpen(false);
  };

  const onDragStart = (e: React.DragEvent, type: EntityType) => {
    e.dataTransfer.setData(DND_MIME, type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Group existing entities by type
  const entitiesByType = useMemo(() => {
    const groups: Record<string, typeof entities> = {};
    for (const e of entities) {
      const t = e.type || 'character';
      if (!groups[t]) groups[t] = [];
      groups[t].push(e);
    }
    return groups;
  }, [entities]);

  const filteredEntitiesByType = useMemo(() => {
    if (!search) return entitiesByType;
    const groups: Record<string, typeof entities> = {};
    for (const [t, list] of Object.entries(entitiesByType)) {
      const filtered = list.filter((e) => e.name.includes(search));
      if (filtered.length > 0) groups[t] = filtered;
    }
    return groups;
  }, [entitiesByType, search]);

  // Ordered type list for existing entities section
  const typeOrder: EntityType[] = ['character', 'faction', 'event', 'location', 'item'];

  return (
    <div className="mt-panel" style={{ width: 230, borderTop: 'none', borderBottom: 'none' }}>
      <div className="mt-panel-title">🎨 实体调色盘</div>

      {/* Search */}
      <div style={{ padding: 6, borderBottom: '1px solid var(--mt-border-soft)' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索实体..."
          style={inputStyle}
        />
      </div>

      <div className="mt-panel-body">
        {/* Entity type categories — drag onto canvas to create */}
        {PALETTE_CATEGORIES.map((cat) => {
          const isCollapsed = collapsed[`cat-${cat.name}`];
          return (
            <div key={cat.name}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [`cat-${cat.name}`]: !isCollapsed }))}
                style={catHeaderStyle}
              >
                <span style={{ fontSize: 9, width: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
                {cat.name}
              </div>
              {!isCollapsed &&
                cat.types.map((t) => {
                  const c = ENTITY_CONFIG[t];
                  const count = entitiesByType[t]?.length || 0;
                  return (
                    <div
                      key={t}
                      draggable
                      onDragStart={(e) => onDragStart(e, t)}
                      onDoubleClick={() => { setNewType(t); setCreateOpen(true); }}
                      title={`拖拽到画布创建「${c.label}」，或双击`}
                      style={typeRowStyle}
                      onMouseEnter={(ev) => ((ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)')}
                      onMouseLeave={(ev) => ((ev.currentTarget as HTMLDivElement).style.background = 'transparent')}
                    >
                      <span
                        style={{
                          width: 22, height: 22, borderRadius: 5, background: '#fff',
                          border: `1px solid ${c.color}`, borderBottom: `2px solid ${c.color}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                        }}
                      >
                        {c.icon}
                      </span>
                      <span style={{ fontSize: 12 }}>{c.label}</span>
                      {count > 0 && (
                        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--mt-text-faint)' }}>{count}</span>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}

        {/* Existing entities — grouped by type, collapsible */}
        <div style={{ ...catHeaderStyle, cursor: 'default', marginTop: 4 }}>
          📂 图谱实体 ({entities.length})
        </div>

        {typeOrder.map((t) => {
          const list = filteredEntitiesByType[t];
          if (!list || list.length === 0) return null;
          const c = ENTITY_CONFIG[t];
          const key = `entities-${t}`;
          const isCollapsed = collapsed[key];

          return (
            <div key={t}>
              <div
                onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !isCollapsed }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px 4px 10px',
                  fontSize: 11, fontWeight: 600, color: c.color,
                  cursor: 'pointer', userSelect: 'none',
                  borderTop: '1px solid var(--mt-border-soft)',
                  background: 'rgba(255,255,255,0.5)',
                }}
              >
                <span style={{ fontSize: 8, width: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
                <span style={{ fontSize: 12 }}>{c.icon}</span>
                {c.label}
                <span style={{
                  marginLeft: 'auto', fontSize: 10, fontWeight: 400,
                  color: 'var(--mt-text-faint)',
                  background: 'var(--mt-panel-header)', borderRadius: 8,
                  padding: '0 5px', lineHeight: '16px',
                }}>
                  {list.length}
                </span>
              </div>

              {!isCollapsed && list.map((e) => {
                const sel = selectedEntityId === e.id;
                return (
                  <div
                    key={e.id}
                    onClick={() => setSelectedEntity(e.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 2px 24px',
                      cursor: 'pointer', fontSize: 11, lineHeight: 1.4,
                      background: sel ? 'var(--mt-sel-fill)' : 'transparent',
                      color: sel ? 'var(--mt-accent-dark)' : 'var(--mt-text)',
                      borderLeft: sel ? `2px solid ${c.color}` : '2px solid transparent',
                    }}
                    onMouseEnter={(ev) => { if (!sel) (ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
                    onMouseLeave={(ev) => { if (!sel) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {e.name}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Create form */}
      {createOpen && (
        <div style={{ borderTop: '1px solid var(--mt-border)', padding: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>新建实体</div>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="实体名称"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
            {(['character', 'location', 'event', 'item', 'faction'] as EntityType[]).map((t) => {
              const c = ENTITY_CONFIG[t];
              const on = newType === t;
              return (
                <button
                  key={t}
                  onClick={() => setNewType(t)}
                  className={`mt-btn${on ? ' active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 6px', border: `1px solid ${on ? c.color : 'var(--mt-border)'}` }}
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleCreate} disabled={!newName.trim()} className="mt-btn active" style={{ flex: 1, justifyContent: 'center', fontWeight: 600 }}>
              创建
            </button>
            <button onClick={() => setCreateOpen(false)} className="mt-btn" style={{ border: '1px solid var(--mt-border)' }}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#fff',
  border: '1px solid var(--mt-border)',
  borderRadius: 3,
  padding: '5px 8px',
  color: 'var(--mt-text)',
  fontSize: 12,
  outline: 'none',
};

const catHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.5,
  color: '#5a5a5a',
  background: 'linear-gradient(var(--mt-panel-header-2), var(--mt-panel-header))',
  borderTop: '1px solid var(--mt-border-soft)',
  borderBottom: '1px solid var(--mt-border-soft)',
  cursor: 'pointer',
  userSelect: 'none',
  textTransform: 'uppercase',
};

const typeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 10px 4px 18px',
  cursor: 'grab',
};
