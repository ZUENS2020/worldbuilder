import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, RELATION_CONFIG, TAG_COLORS, getRelationConfig } from '../../types';
import type { EntityType, RelationType } from '../../types';
import TextEditorModal from '../common/TextEditorModal';
import Markdown from '../common/Markdown';
import TransformPanel from '../Transform/TransformPanel';
import EntityPropertyList from './EntityPropertyList';
import { buildPropertiesWithOrder, getOrderedPropertyEntries } from '../../utils/propertyOrder';
import { ImeInput } from '../common/ImeInput';

// Built-in relation type keys
const BUILTIN_RELATION_TYPES = Object.keys(RELATION_CONFIG) as RelationType[];

export default function Inspector() {
  const {
    selectedEntityId, selectedEntityIds, setSelectedEntities, entities, relations, updateEntity, removeEntity,
    executeTransform, addRelation, removeRelation, focusOnEntity,
    customRelationTypes, addCustomRelationType, removeCustomRelationType,
    inspectorTab, setInspectorTab,
  } = useAppStore();

  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  // Long string fields render as Markdown by default; toggled here to edit inline.
  const [inlineEditFields, setInlineEditFields] = useState<Set<string>>(new Set());
  const toggleInlineEdit = (key: string) =>
    setInlineEditFields((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Add relation form state
  const [showAddRel, setShowAddRel] = useState(false);
  const [newRelTargetId, setNewRelTargetId] = useState('');
  const [newRelType, setNewRelType] = useState<string>('ally');
  const [newRelDirection, setNewRelDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [addingRel, setAddingRel] = useState(false);

  // Custom type creation form (inside the add-relation form)
  const [showCustomType, setShowCustomType] = useState(false);
  const [customTypeName, setCustomTypeName] = useState('');
  const [customTypeColor, setCustomTypeColor] = useState(TAG_COLORS[0]);
  const [customTypeStyle, setCustomTypeStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');

  // Merged config for rendering
  const allRelConfig = getRelationConfig(customRelationTypes);

  const entity = entities.find((e) => e.id === selectedEntityId);
  const multiSelected = selectedEntityIds.length > 1
    ? entities.filter((e) => selectedEntityIds.includes(e.id))
    : [];

  const tabBtn = (tab: 'details' | 'transform', label: string) => (
    <button
      type="button"
      className={`mt-btn${inspectorTab === tab ? ' active' : ''}`}
      style={{ fontSize: 11, padding: '2px 10px', height: 20, fontWeight: inspectorTab === tab ? 600 : 400 }}
      onClick={() => setInspectorTab(tab)}
    >
      {label}
    </button>
  );

  const tabBar = (showBack = false) => (
    <div className="mt-panel-title" style={{ justifyContent: 'space-between', gap: 6 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {tabBtn('details', '🔎 详情')}
        {tabBtn('transform', '🕸️ Transform')}
      </div>
      {showBack && (
        <button
          type="button"
          className="mt-btn"
          style={{ fontSize: 10, padding: '1px 8px', height: 20, border: '1px solid var(--mt-border)', color: 'var(--mt-text-muted)' }}
          onClick={() => setInspectorTab('details')}
          title="返回详情 (Esc)"
        >
          ← 详情 · Esc
        </button>
      )}
    </div>
  );

  if (inspectorTab === 'transform') {
    return (
      <div className="mt-panel" style={{ flex: 1, borderRight: 'none', borderBottom: 'none', borderTop: 'none' }}>
        {tabBar(true)}
        <div className="mt-panel-body" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
          <TransformPanel />
        </div>
      </div>
    );
  }

  if (multiSelected.length > 1) {
    return (
      <div className="mt-panel" style={{ flex: 1, borderRight: 'none', borderBottom: 'none', borderTop: 'none' }}>
        {tabBar()}
        <div className="mt-panel-body" style={{ padding: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--mt-accent-dark)' }}>
            已选中 {multiSelected.length} 个实体
          </div>
          <div style={{ fontSize: 11, color: 'var(--mt-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            点击列表项查看单个实体详情；右键节点可运行 Transform（以主选节点为准）。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '60vh', overflowY: 'auto' }}>
            {multiSelected.map((e) => {
              const cfg = ENTITY_CONFIG[e.type as EntityType] || ENTITY_CONFIG.character;
              return (
                <button
                  key={e.id}
                  type="button"
                  className="mt-btn"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    padding: '6px 8px', fontSize: 12, border: '1px solid var(--mt-border-soft)',
                    fontWeight: e.id === selectedEntityId ? 600 : 400,
                  }}
                  onClick={() => setSelectedEntities([e.id])}
                >
                  <span style={{ fontSize: 14 }}>{cfg.icon}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                  <span style={{ fontSize: 10, color: cfg.color }}>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="mt-panel" style={{ flex: 1, borderRight: 'none', borderBottom: 'none', borderTop: 'none' }}>
        {tabBar()}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mt-text-muted)', fontSize: 12, textAlign: 'center', padding: 16 }}>
          <div>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>🔍</div>
            选择一个实体查看属性<br />
            <span style={{ fontSize: 11 }}>使用左上角框选工具多选 · 右键节点打开 Transform</span>
          </div>
        </div>
      </div>
    );
  }

  const config = ENTITY_CONFIG[entity.type as EntityType] || ENTITY_CONFIG.character;
  const entityRelations = relations.filter((r) => r.source_id === entity.id || r.target_id === entity.id);

  const handlePropertyChange = (key: string, value: string) =>
    updateEntity(entity.id, { properties: { ...entity.properties, [key]: value } });

  const handleNameChange = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === entity.name) return;
    updateEntity(entity.id, { name: trimmed });
  };

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
    if (!key || key === '_property_order' || key === 'name' || key === 'label') return;
    const value = prompt('属性值:');
    if (value === null) return;
    const entries = getOrderedPropertyEntries(entity.properties);
    entries.push([key, value]);
    updateEntity(entity.id, { properties: buildPropertiesWithOrder(entries, entity.properties || {}) });
  };

  const handleAddRelation = async () => {
    if (!newRelTargetId) return;
    setAddingRel(true);
    const sourceId = newRelDirection === 'outgoing' ? entity.id : newRelTargetId;
    const targetId = newRelDirection === 'outgoing' ? newRelTargetId : entity.id;
    await addRelation({ source_id: sourceId, target_id: targetId, type: newRelType as RelationType, weight: 0.5 });
    setShowAddRel(false);
    setNewRelTargetId('');
    setShowCustomType(false);
    setAddingRel(false);
  };

  const handleCreateCustomType = () => {
    if (!customTypeName.trim()) return;
    addCustomRelationType(customTypeName.trim(), customTypeColor, customTypeStyle);
    // Set the new type as the selected type (id will be generated, use name for now)
    // The newly added type's id will be available next render
    setCustomTypeName('');
    setShowCustomType(false);
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
      {tabBar()}
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
            <ImeInput
              value={entity.name}
              onCommit={handleNameChange}
              title="实体名称（失焦或 Enter 保存）"
              style={{
                width: '100%', fontWeight: 600, fontSize: 14,
                background: 'transparent', border: '1px solid transparent', borderRadius: 3,
                padding: '2px 4px', color: 'var(--mt-text)', outline: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.borderColor = 'var(--mt-border)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            />
            <div style={{ color: config.color, fontSize: 11, paddingLeft: 4 }}>{config.label}</div>
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
                marginTop: 8, padding: '6px 8px', borderRadius: 4, fontSize: 11,
                background: aiResult.startsWith('错误') ? '#fdecea' : '#eafaf0',
                color: aiResult.startsWith('错误') ? '#c0392b' : '#1f7a3d',
                border: `1px solid ${aiResult.startsWith('错误') ? '#f3c6c0' : '#bfe6cd'}`,
              }}
            >
              <Markdown style={{ fontSize: 11, color: 'inherit' }}>{aiResult}</Markdown>
            </div>
          )}
        </div>

        <EntityPropertyList
          entityId={entity.id}
          properties={entity.properties || {}}
          updateEntity={updateEntity}
          inlineEditFields={inlineEditFields}
          toggleInlineEdit={toggleInlineEdit}
          setEditingField={setEditingField}
          fieldStyle={fieldStyle}
          sectionLabel={sectionLabel}
          onAdd={handleAddProperty}
        />

        {/* Relations */}
        <div style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={sectionLabel}>关系 Links ({entityRelations.length})</span>
            <button className="mt-btn" onClick={() => { setShowAddRel(true); setNewRelTargetId(''); setShowCustomType(false); }} style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--mt-border)' }}>＋ 添加</button>
          </div>

          {entityRelations.length === 0 && !showAddRel && (
            <div style={{ color: 'var(--mt-text-faint)', fontSize: 11 }}>（暂无关系）</div>
          )}

          {entityRelations.map((r) => {
            const isSource = r.source_id === entity.id;
            const other = entities.find((e) => e.id === (isSource ? r.target_id : r.source_id));
            const otherConfig = other ? ENTITY_CONFIG[other.type as EntityType] : null;
            const relConfig = allRelConfig[r.type] || { color: '#888', label: r.type };
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--mt-border-soft)' }}>
                <span style={{ color: 'var(--mt-text-muted)', fontWeight: 700, fontSize: 11 }}>{isSource ? '→' : '←'}</span>
                <span style={{ color: relConfig.color, fontSize: 10, background: `${relConfig.color}1e`, padding: '1px 6px', borderRadius: 3, border: `1px solid ${relConfig.color}40` }}>
                  {relConfig.label}
                </span>
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
                <span
                  onClick={() => removeRelation(r.id)}
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
                  onChange={(e) => setNewRelType(e.target.value)}
                  style={{ ...fieldStyle, padding: '3px 6px' }}
                >
                  <optgroup label="内置类型">
                    {BUILTIN_RELATION_TYPES.map((rt) => {
                      const rc = RELATION_CONFIG[rt];
                      return <option key={rt} value={rt}>{rc.label}</option>;
                    })}
                  </optgroup>
                  {customRelationTypes.length > 0 && (
                    <optgroup label="自定义类型">
                      {customRelationTypes.map((ct) => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {/* Custom type creation toggle */}
                <button
                  className="mt-btn"
                  onClick={() => setShowCustomType((v) => !v)}
                  style={{ fontSize: 9, padding: '1px 6px', marginTop: 4, border: '1px solid var(--mt-border)', color: 'var(--mt-accent)' }}
                >
                  {showCustomType ? '▲ 收起' : '✏️ 自定义新类型...'}
                </button>
              </div>

              {/* Custom type creation form */}
              {showCustomType && (
                <div style={{
                  padding: 6, marginBottom: 6, borderRadius: 3,
                  border: '1px dashed var(--mt-accent)', background: '#fff',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginBottom: 4, fontWeight: 600 }}>新建自定义关系类型</div>
                  <input
                    value={customTypeName}
                    onChange={(e) => setCustomTypeName(e.target.value)}
                    placeholder="类型名称（如：师承）"
                    style={{ ...fieldStyle, marginBottom: 4, padding: '3px 6px', fontSize: 11 }}
                  />
                  {/* Color selection */}
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                    {TAG_COLORS.map((c) => (
                      <span
                        key={c}
                        onClick={() => setCustomTypeColor(c)}
                        style={{
                          width: 16, height: 16, borderRadius: '50%', background: c,
                          border: customTypeColor === c ? '2px solid #333' : '2px solid #fff',
                          cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                        }}
                      />
                    ))}
                  </div>
                  {/* Line style */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                      <button
                        key={s}
                        className={`mt-btn${customTypeStyle === s ? ' active' : ''}`}
                        onClick={() => setCustomTypeStyle(s)}
                        style={{ fontSize: 9, padding: '2px 6px', border: `1px solid ${customTypeStyle === s ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
                      >
                        {s === 'solid' ? '━━ 实线' : s === 'dashed' ? '┅┅ 虚线' : '···· 点线'}
                      </button>
                    ))}
                  </div>
                  <button
                    className="mt-btn active"
                    onClick={handleCreateCustomType}
                    disabled={!customTypeName.trim()}
                    style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--mt-accent)', fontWeight: 600 }}
                  >
                    创建并选用
                  </button>
                </div>
              )}

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
                  onClick={() => { setShowAddRel(false); setShowCustomType(false); }}
                  style={{ fontSize: 11, border: '1px solid var(--mt-border)' }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Custom relation types management */}
          {customRelationTypes.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={sectionLabel}>自定义关系类型</div>
              {customRelationTypes.map((ct) => (
                <div key={ct.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: ct.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{ct.name}</span>
                  <span style={{ fontSize: 9, color: 'var(--mt-text-faint)' }}>
                    {ct.style === 'solid' ? '实线' : ct.style === 'dashed' ? '虚线' : '点线'}
                  </span>
                  <span
                    onClick={() => removeCustomRelationType(ct.id)}
                    style={{ fontSize: 10, color: '#ccc', cursor: 'pointer' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#c0392b'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#ccc'; }}
                    title="删除自定义类型"
                  >
                    ✕
                  </span>
                </div>
              ))}
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
