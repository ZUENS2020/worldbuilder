import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, RELATION_CONFIG } from '../../types';
import type { EntityType, RelationType } from '../../types';
import TextEditorModal from '../common/TextEditorModal';

// All available relation types for the add-relation form
const ALL_RELATION_TYPES = Object.keys(RELATION_CONFIG) as RelationType[];

export default function Inspector() {
  const { selectedEntityId, entities, relations, updateEntity, removeEntity, executeTransform, addRelation, removeRelation, focusOnEntity } = useAppStore();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);

  // Add relation form state
  const [showAddRel, setShowAddRel] = useState(false);
  const [newRelTargetId, setNewRelTargetId] = useState('');
  const [newRelType, setNewRelType] = useState<RelationType>('ally');
  const [newRelDirection, setNewRelDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [addingRel, setAddingRel] = useState(false);

  const entity = entities.find((e) => e.id === selectedEntityId);

  if (!entity) {
    return (
      <div className="mt-panel" style={{ flex: 1, borderRight: 'none', borderBottom: 'none', borderTop: 'none' }}>
        <div className="mt-panel-title">🔎 详情 · Property View</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mt-text-muted)', fontSize: 12, textAlign: 'center', padding: 16 }}>
          <div>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>🔍</div>
            选择一个实体查看属性<br />
            <span style={{ fontSize: 11 }}>右键节点运行 Transform</span>
          </div>
        </div>
      </div>
    );
  }

  const config = ENTITY_CONFIG[entity.type as EntityType] || ENTITY_CONFIG.character;
  const entityRelations = relations.filter((r) => r.source_id === entity.id || r.target_id === entity.id);

  const handlePropertyChange = (key: string, value: string) =>
    updateEntity(entity.id, { properties: { ...entity.properties, [key]: value } });

  const handleDelete = () => { if (confirm(`确定删除 ${entity.name}？`)) removeEntity(entity.id); };

  const handleAITransform = async (type: string) => {
    setAiLoading(type);
    setAiResult(null);
    try {
      const result = await executeTransform(entity.id, type);
      if (result) setAiResult(result.message);
    } catch (e: any) {
      setAiResult(`错误: ${e.message}`);
    }
    setAiLoading(null);
  };

  const handleAddProperty = () => {
    const key = prompt('属性名:');
    if (!key) return;
    const value = prompt('属性值:');
    if (value === null) return;
    updateEntity(entity.id, { properties: { ...entity.properties, [key]: value } });
  };

  const handleAddRelation = async () => {
    if (!newRelTargetId) return;
    setAddingRel(true);
    const sourceId = newRelDirection === 'outgoing' ? entity.id : newRelTargetId;
    const targetId = newRelDirection === 'outgoing' ? newRelTargetId : entity.id;
    await addRelation({ source_id: sourceId, target_id: targetId, type: newRelType, weight: 0.5 });
    setShowAddRel(false);
    setNewRelTargetId('');
    setAddingRel(false);
  };

  const handleDeleteRelation = (relId: string) => {
    removeRelation(relId);
  };

  // Other entities for the target dropdown (exclude self)
  const otherEntities = entities.filter((e) => e.id !== entity.id);

  const aiActions = [
    { id: 'ai_infer', label: '🔮 推断潜在关联', busy: '推断中...' },
    { id: 'ai_conflict', label: '⚠️ 检测矛盾', busy: '检测中...' },
    { id: 'ai_backstory', label: '✨ 生成背景故事', busy: '生成中...' },
  ];

  return (
    <div className="mt-panel" style={{ flex: 1, borderRight: 'none', borderBottom: 'none', borderTop: 'none' }}>
      <div className="mt-panel-title">🔎 详情 · Property View</div>
      <div className="mt-panel-body">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 10px', borderBottom: '1px solid var(--mt-border-soft)' }}>
          <span
            style={{
              width: 34, height: 34, borderRadius: 7, background: '#fff',
              border: `1px solid ${config.color}`, borderBottom: `3px solid ${config.color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
            }}
          >
            {config.icon}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entity.name}</div>
            <div style={{ color: config.color, fontSize: 11 }}>{config.label}</div>
          </div>
          <button className="mt-btn" onClick={handleDelete} title="删除" style={{ color: '#c0392b' }}>🗑️</button>
        </div>

        {/* AI actions */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mt-border-soft)' }}>
          <div style={sectionLabel}>🤖 AI 操作</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {aiActions.map((a) => (
              <button
                key={a.id}
                onClick={() => handleAITransform(a.id)}
                disabled={!!aiLoading}
                className="mt-btn"
                style={{ justifyContent: 'flex-start', border: '1px solid var(--mt-border)', padding: '5px 8px', fontSize: 11 }}
              >
                {aiLoading === a.id ? `⏳ ${a.busy}` : a.label}
              </button>
            ))}
          </div>
          {aiResult && (
            <div
              style={{
                marginTop: 8, padding: '6px 8px', borderRadius: 4, fontSize: 11, whiteSpace: 'pre-wrap',
                background: aiResult.startsWith('错误') ? '#fdecea' : '#eafaf0',
                color: aiResult.startsWith('错误') ? '#c0392b' : '#1f7a3d',
                border: `1px solid ${aiResult.startsWith('错误') ? '#f3c6c0' : '#bfe6cd'}`,
              }}
            >
              {aiResult}
            </div>
          )}
        </div>

        {/* Properties */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mt-border-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={sectionLabel}>属性 Properties</span>
            <button className="mt-btn" onClick={handleAddProperty} style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--mt-border)' }}>＋ 添加</button>
          </div>
          {Object.keys(entity.properties || {}).length === 0 && (
            <div style={{ color: 'var(--mt-text-faint)', fontSize: 11 }}>（暂无属性）</div>
          )}
          {Object.entries(entity.properties || {}).map(([key, value]) => {
            const isString = typeof value === 'string';
            const isLong = isString && (value as string).length > 80;
            return (
              <div key={key} style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: 'var(--mt-text-muted)', fontSize: 10 }}>{key}</span>
                  {isString && (
                    <button
                      className="mt-btn"
                      style={{ fontSize: 9, padding: '0 5px', height: 16, color: 'var(--mt-accent)' }}
                      onClick={() => setEditingField(key)}
                      title="放大编辑"
                    >
                      ⤢ 放大
                    </button>
                  )}
                </div>
                {isLong ? (
                  <textarea value={value as string} onChange={(e) => handlePropertyChange(key, e.target.value)} rows={8} style={fieldStyle} />
                ) : (
                  <input value={String(value)} onChange={(e) => handlePropertyChange(key, e.target.value)} style={fieldStyle} />
                )}
              </div>
            );
          })}
        </div>

        {/* Relations */}
        <div style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={sectionLabel}>关系 Links ({entityRelations.length})</span>
            <button className="mt-btn" onClick={() => { setShowAddRel(true); setNewRelTargetId(''); }} style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--mt-border)' }}>＋ 添加</button>
          </div>

          {entityRelations.length === 0 && !showAddRel && (
            <div style={{ color: 'var(--mt-text-faint)', fontSize: 11 }}>（暂无关系）</div>
          )}

          {entityRelations.map((r) => {
            const isSource = r.source_id === entity.id;
            const other = entities.find((e) => e.id === (isSource ? r.target_id : r.source_id));
            const otherConfig = other ? ENTITY_CONFIG[other.type as EntityType] : null;
            const relConfig = RELATION_CONFIG[r.type] || { color: '#888', label: r.type };
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--mt-border-soft)' }}>
                <span style={{ color: 'var(--mt-text-muted)', fontWeight: 700, fontSize: 11 }}>{isSource ? '→' : '←'}</span>
                <span style={{ color: relConfig.color, fontSize: 10, background: `${relConfig.color}1e`, padding: '1px 6px', borderRadius: 3, border: `1px solid ${relConfig.color}40` }}>
                  {relConfig.label}
                </span>
                {/* Clickable entity name — focuses on the node in the graph */}
                <span
                  onClick={() => focusOnEntity((isSource ? r.target_id : r.source_id))}
                  style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    cursor: 'pointer', color: otherConfig?.color || 'var(--mt-text)',
                  }}
                  title={`在图中定位「${other?.name || '?'}」`}
                >
                  {otherConfig?.icon} {other?.name || '?'}
                </span>
                <span style={{ color: 'var(--mt-text-faint)', fontSize: 9 }}>{Math.round((r.weight ?? 0) * 100)}%</span>
                {/* Delete relation button */}
                <span
                  onClick={() => handleDeleteRelation(r.id)}
                  style={{ fontSize: 10, color: '#ccc', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#c0392b'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#ccc'; }}
                  title="删除关系"
                >
                  ✕
                </span>
              </div>
            );
          })}

          {/* ── Add relation inline form ── */}
          {showAddRel && (
            <div style={{
              marginTop: 8, padding: 8, borderRadius: 4,
              border: '1px solid var(--mt-accent)', background: 'var(--mt-sel-fill)',
            }}>
              {/* Target entity */}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginBottom: 3 }}>目标实体</div>
                <select
                  value={newRelTargetId}
                  onChange={(e) => setNewRelTargetId(e.target.value)}
                  style={{ ...fieldStyle, padding: '3px 6px' }}
                >
                  <option value="">选择实体...</option>
                  {otherEntities.map((e) => {
                    const ec = ENTITY_CONFIG[e.type as EntityType];
                    return <option key={e.id} value={e.id}>{ec.icon} {e.name}</option>;
                  })}
                </select>
              </div>

              {/* Relation type */}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginBottom: 3 }}>关系类型</div>
                <select
                  value={newRelType}
                  onChange={(e) => setNewRelType(e.target.value as RelationType)}
                  style={{ ...fieldStyle, padding: '3px 6px' }}
                >
                  {ALL_RELATION_TYPES.map((rt) => {
                    const rc = RELATION_CONFIG[rt];
                    return <option key={rt} value={rt}>{rc.label} ({rt})</option>;
                  })}
                </select>
              </div>

              {/* Direction */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginBottom: 3 }}>方向</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={`mt-btn${newRelDirection === 'outgoing' ? ' active' : ''}`}
                    onClick={() => setNewRelDirection('outgoing')}
                    style={{ fontSize: 10, padding: '2px 8px', border: `1px solid ${newRelDirection === 'outgoing' ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
                  >
                    {entity.name} → 目标
                  </button>
                  <button
                    className={`mt-btn${newRelDirection === 'incoming' ? ' active' : ''}`}
                    onClick={() => setNewRelDirection('incoming')}
                    style={{ fontSize: 10, padding: '2px 8px', border: `1px solid ${newRelDirection === 'incoming' ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
                  >
                    目标 → {entity.name}
                  </button>
                </div>
              </div>

              {/* Submit / Cancel */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="mt-btn active"
                  onClick={handleAddRelation}
                  disabled={!newRelTargetId || addingRel}
                  style={{ flex: 1, justifyContent: 'center', fontWeight: 600, fontSize: 11, border: '1px solid var(--mt-accent)' }}
                >
                  {addingRel ? '添加中...' : '确认添加'}
                </button>
                <button
                  className="mt-btn"
                  onClick={() => setShowAddRel(false)}
                  style={{ fontSize: 11, border: '1px solid var(--mt-border)' }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editingField && (
        <TextEditorModal
          title={`${entity.name} · ${editingField}`}
          initialValue={String(entity.properties?.[editingField] ?? '')}
          onSave={(v) => handlePropertyChange(editingField, v)}
          onClose={() => setEditingField(null)}
        />
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  color: 'var(--mt-text-muted)', fontSize: 10, marginBottom: 7,
  textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, display: 'block',
};

const fieldStyle: React.CSSProperties = {
  width: '100%', background: '#fff', border: '1px solid var(--mt-border)', borderRadius: 3,
  padding: '4px 7px', color: 'var(--mt-text)', fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit',
};
