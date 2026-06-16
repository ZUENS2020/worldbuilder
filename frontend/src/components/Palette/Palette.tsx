import { useState } from 'react';
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

  const filtered = search ? entities.filter((e) => e.name.includes(search)) : entities;

  return (
    <div className="mt-panel" style={{ width: 230, borderTop: 'none', borderBottom: 'none' }}>
      <div className="mt-panel-title">🎨 实体调色盘 · Entity Palette</div>

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
        {/* Entity type categories (drag onto canvas to create) */}
        {PALETTE_CATEGORIES.map((cat) => {
          const isCollapsed = collapsed[cat.name];
          return (
            <div key={cat.name}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [cat.name]: !c[cat.name] }))}
                style={catHeaderStyle}
              >
                <span style={{ fontSize: 9, width: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
                {cat.name}
              </div>
              {!isCollapsed &&
                cat.types.map((t) => {
                  const c = ENTITY_CONFIG[t];
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
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--mt-text-faint)' }}>⠿</span>
                    </div>
                  );
                })}
            </div>
          );
        })}

        {/* Existing entities in the current graph */}
        <div style={{ ...catHeaderStyle, cursor: 'default', marginTop: 4 }}>
          📂 图谱中的实体 ({filtered.length})
        </div>
        {filtered.map((e) => {
          const c = ENTITY_CONFIG[e.type] || ENTITY_CONFIG.character;
          const sel = selectedEntityId === e.id;
          return (
            <div
              key={e.id}
              onClick={() => setSelectedEntity(e.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '3px 10px 3px 16px',
                cursor: 'pointer', fontSize: 12,
                background: sel ? 'var(--mt-sel-fill)' : 'transparent',
                color: 'var(--mt-text)',
              }}
              onMouseEnter={(ev) => { if (!sel) (ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
              onMouseLeave={(ev) => { if (!sel) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13 }}>{c.icon}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
            </div>
          );
        })}
      </div>

      {/* Create form (toggled from toolbar / double-click) */}
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
