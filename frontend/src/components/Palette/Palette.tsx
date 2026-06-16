import { useState, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, PALETTE_CATEGORIES, TAG_COLORS } from '../../types';
import type { EntityType, Tag } from '../../types';

export const DND_MIME = 'application/worldbuilder-entity-type';

export default function Palette() {
  const {
    addEntity, project, entities, selectedEntityId,
    createOpen, setCreateOpen, focusOnEntity,
    tags, addTag, removeTag, renameTag, addEntityToTag, removeEntityFromTag,
  } = useAppStore();

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EntityType>('character');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'type' | 'tag'>('type');

  // New tag form
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [showNewTag, setShowNewTag] = useState(false);

  // Inline rename
  const [renamingTagId, setRenamingTagId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Entity context menu (add-to-tag)
  const [entityMenuId, setEntityMenuId] = useState<string | null>(null);

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

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    addTag(newTagName.trim(), newTagColor);
    setNewTagName('');
    setShowNewTag(false);
  };

  const handleRenameTag = (id: string) => {
    if (!renameValue.trim()) return;
    renameTag(id, renameValue.trim());
    setRenamingTagId(null);
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

  // Tagged entities map
  const taggedEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tags) for (const eid of t.entityIds) ids.add(eid);
    return ids;
  }, [tags]);

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

        {/* ── Separator ── */}
        <div style={{ height: 6 }} />

        {/* View mode tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--mt-border-soft)',
          background: 'var(--mt-panel-header)',
        }}>
          <button
            onClick={() => setViewMode('type')}
            style={{
              flex: 1, padding: '4px 0', fontSize: 11, fontWeight: viewMode === 'type' ? 700 : 400,
              color: viewMode === 'type' ? 'var(--mt-accent-dark)' : 'var(--mt-text-muted)',
              background: viewMode === 'type' ? '#fff' : 'transparent',
              border: 'none', borderBottom: viewMode === 'type' ? '2px solid var(--mt-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            按类型
          </button>
          <button
            onClick={() => setViewMode('tag')}
            style={{
              flex: 1, padding: '4px 0', fontSize: 11, fontWeight: viewMode === 'tag' ? 700 : 400,
              color: viewMode === 'tag' ? 'var(--mt-accent-dark)' : 'var(--mt-text-muted)',
              background: viewMode === 'tag' ? '#fff' : 'transparent',
              border: 'none', borderBottom: viewMode === 'tag' ? '2px solid var(--mt-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            按标签
          </button>
        </div>

        {/* ── By Type view ── */}
        {viewMode === 'type' && typeOrder.map((t) => {
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

              {!isCollapsed && list.map((e) => (
                <EntityRow
                  key={e.id}
                  entityId={e.id}
                  name={e.name}
                  selected={selectedEntityId === e.id}
                  tags={tags}
                  tagColor={c.color}
                  onSelect={() => focusOnEntity(e.id)}
                  onAddToTag={addEntityToTag}
                  onRemoveFromTag={removeEntityFromTag}
                  entityMenuId={entityMenuId}
                  setEntityMenuId={setEntityMenuId}
                />
              ))}
            </div>
          );
        })}

        {/* ── By Tag view ── */}
        {viewMode === 'tag' && (
          <>
            {tags.map((tag) => {
              const key = `tag-${tag.id}`;
              const isCollapsed = collapsed[key];
              const tagEntities = tag.entityIds
                .map((eid) => entities.find((e) => e.id === eid))
                .filter(Boolean);

              return (
                <div key={tag.id}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px 4px 10px',
                      fontSize: 11, fontWeight: 600, color: tag.color,
                      cursor: 'pointer', userSelect: 'none',
                      borderTop: '1px solid var(--mt-border-soft)',
                      background: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    <span
                      style={{ fontSize: 8, width: 10, cursor: 'pointer' }}
                      onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !isCollapsed }))}
                    >
                      {isCollapsed ? '▶' : '▼'}
                    </span>

                    {/* Color dot */}
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: tag.color, flexShrink: 0,
                    }} />

                    {/* Name (inline rename) */}
                    {renamingTagId === tag.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRenameTag(tag.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameTag(tag.id);
                          if (e.key === 'Escape') setRenamingTagId(null);
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          flex: 1, fontSize: 11, border: '1px solid var(--mt-accent)',
                          borderRadius: 2, padding: '1px 4px', outline: 'none',
                        }}
                      />
                    ) : (
                      <span
                        style={{ flex: 1 }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenamingTagId(tag.id);
                          setRenameValue(tag.name);
                        }}
                      >
                        {tag.name}
                      </span>
                    )}

                    <span style={{
                      fontSize: 10, fontWeight: 400,
                      color: 'var(--mt-text-faint)',
                      background: 'var(--mt-panel-header)', borderRadius: 8,
                      padding: '0 5px', lineHeight: '16px',
                    }}>
                      {tagEntities.length}
                    </span>

                    {/* Delete tag */}
                    <span
                      onClick={(e) => { e.stopPropagation(); removeTag(tag.id); }}
                      style={{ fontSize: 12, color: '#999', cursor: 'pointer', padding: '0 2px' }}
                      title="删除标签"
                    >
                      ✕
                    </span>
                  </div>

                  {!isCollapsed && tagEntities.map((e) => e && (
                    <EntityRow
                      key={e.id}
                      entityId={e.id}
                      name={e.name}
                      selected={selectedEntityId === e.id}
                      tags={tags}
                      tagColor={tag.color}
                      onSelect={() => focusOnEntity(e.id)}
                      onAddToTag={addEntityToTag}
                      onRemoveFromTag={removeEntityFromTag}
                      entityMenuId={entityMenuId}
                      setEntityMenuId={setEntityMenuId}
                      currentTagId={tag.id}
                    />
                  ))}
                </div>
              );
            })}

            {/* Unclassified entities */}
            {(() => {
              const untagged = entities.filter((e) => !taggedEntityIds.has(e.id));
              if (untagged.length === 0) return null;
              const key = 'tag-uncategorized';
              const isCollapsed = collapsed[key];
              return (
                <div>
                  <div
                    onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !isCollapsed }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px 4px 10px',
                      fontSize: 11, fontWeight: 600, color: '#999',
                      cursor: 'pointer', userSelect: 'none',
                      borderTop: '1px solid var(--mt-border-soft)',
                      background: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    <span style={{ fontSize: 8, width: 10 }}>{isCollapsed ? '▶' : '▼'}</span>
                    未归类
                    <span style={{
                      marginLeft: 'auto', fontSize: 10, fontWeight: 400,
                      color: 'var(--mt-text-faint)',
                      background: 'var(--mt-panel-header)', borderRadius: 8,
                      padding: '0 5px', lineHeight: '16px',
                    }}>
                      {untagged.length}
                    </span>
                  </div>
                  {!isCollapsed && untagged.map((e) => (
                    <EntityRow
                      key={e.id}
                      entityId={e.id}
                      name={e.name}
                      selected={selectedEntityId === e.id}
                      tags={tags}
                      tagColor="#999"
                      onSelect={() => focusOnEntity(e.id)}
                      onAddToTag={addEntityToTag}
                      onRemoveFromTag={removeEntityFromTag}
                      entityMenuId={entityMenuId}
                      setEntityMenuId={setEntityMenuId}
                    />
                  ))}
                </div>
              );
            })()}

            {/* New tag button */}
            {showNewTag ? (
              <div style={{ padding: 8, borderTop: '1px solid var(--mt-border-soft)', background: '#fafafa' }}>
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="标签名称"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  autoFocus
                  style={{ ...inputStyle, marginBottom: 6 }}
                />
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {TAG_COLORS.map((c) => (
                    <span
                      key={c}
                      onClick={() => setNewTagColor(c)}
                      style={{
                        width: 18, height: 18, borderRadius: '50%', background: c,
                        border: newTagColor === c ? '2px solid #333' : '2px solid #fff',
                        cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleAddTag} disabled={!newTagName.trim()} className="mt-btn active" style={{ flex: 1, justifyContent: 'center', fontWeight: 600, fontSize: 11 }}>
                    创建
                  </button>
                  <button onClick={() => setShowNewTag(false)} className="mt-btn" style={{ fontSize: 11, border: '1px solid var(--mt-border)' }}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowNewTag(true)}
                className="mt-btn"
                style={{
                  width: '100%', margin: '6px 0', justifyContent: 'center',
                  fontSize: 11, border: '1px dashed var(--mt-border)',
                  color: 'var(--mt-text-muted)',
                }}
              >
                + 新建标签
              </button>
            )}
          </>
        )}
      </div>

      {/* Create entity form */}
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

// ── Entity row component with tag context menu ──
function EntityRow({
  entityId, name, selected, tags, tagColor, onSelect,
  onAddToTag, onRemoveFromTag, entityMenuId, setEntityMenuId,
  currentTagId,
}: {
  entityId: string; name: string; selected: boolean;
  tags: Tag[]; tagColor: string; onSelect: () => void;
  onAddToTag: (eid: string, tid: string) => void;
  onRemoveFromTag: (eid: string, tid: string) => void;
  entityMenuId: string | null; setEntityMenuId: (id: string | null) => void;
  currentTagId?: string;
}) {
  const isOpen = entityMenuId === entityId;

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={onSelect}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '2px 10px 2px 24px',
          cursor: 'pointer', fontSize: 11, lineHeight: 1.4,
          background: selected ? 'var(--mt-sel-fill)' : 'transparent',
          color: selected ? 'var(--mt-accent-dark)' : 'var(--mt-text)',
          borderLeft: selected ? `2px solid ${tagColor}` : '2px solid transparent',
        }}
        onMouseEnter={(ev) => { if (!selected) (ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
        onMouseLeave={(ev) => { if (!selected) (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {name}
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); setEntityMenuId(isOpen ? null : entityId); }}
          style={{ fontSize: 10, color: '#bbb', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
          title="添加到标签"
        >
          …
        </span>
      </div>

      {/* Tag context menu */}
      {isOpen && (
        <div style={{
          position: 'absolute', left: 24, top: '100%', zIndex: 100,
          background: '#fff', border: '1px solid var(--mt-border)',
          borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          minWidth: 140, padding: 4,
        }}
          onMouseLeave={() => setEntityMenuId(null)}
        >
          <div style={{ fontSize: 9, color: 'var(--mt-text-faint)', padding: '2px 6px', fontWeight: 600 }}>
            移到标签
          </div>
          {tags.map((t) => {
            const inTag = t.entityIds.includes(entityId);
            return (
              <div
                key={t.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (inTag) {
                    onRemoveFromTag(entityId, t.id);
                  } else {
                    onAddToTag(entityId, t.id);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 6px', fontSize: 11, cursor: 'pointer',
                  borderRadius: 2,
                }}
                onMouseEnter={(ev) => (ev.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'}
                onMouseLeave={(ev) => (ev.currentTarget as HTMLDivElement).style.background = 'transparent'}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: t.color, flexShrink: 0,
                  border: inTag ? '2px solid #333' : '1px solid #ddd',
                }} />
                <span style={{ flex: 1 }}>{t.name}</span>
                {inTag && <span style={{ color: 'var(--mt-accent)', fontSize: 10 }}>✓</span>}
              </div>
            );
          })}
          {currentTagId && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromTag(entityId, currentTagId);
                setEntityMenuId(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 6px', fontSize: 11, cursor: 'pointer',
                borderTop: '1px solid var(--mt-border-soft)', marginTop: 2, paddingTop: 4,
                color: '#c44',
              }}
              onMouseEnter={(ev) => (ev.currentTarget as HTMLDivElement).style.background = '#fff0f0'}
              onMouseLeave={(ev) => (ev.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              ✕ 从此标签移除
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared styles ──
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
