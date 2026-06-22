import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImeInput, ImeTextarea } from '../common/ImeInput';
import Markdown from '../common/Markdown';
import {
  buildPropertiesWithOrder,
  getOrderedPropertyEntries,
  reorderPropertyEntries,
  PROP_VISIBILITY_KEY,
} from '../../utils/propertyOrder';

type PropVisRule = { level: 'public' | 'private' | 'entities'; entities?: string[] };

type EntityPropertyListProps = {
  entityId: string;
  properties: Record<string, unknown>;
  updateEntity: (id: string, data: { properties: Record<string, unknown> }) => void;
  inlineEditFields: Set<string>;
  toggleInlineEdit: (key: string) => void;
  setEditingField: (key: string) => void;
  fieldStyle: React.CSSProperties;
  sectionLabel: React.CSSProperties;
  onAdd: () => void;
  /** Other entities in the project, for the "specific entities" whitelist. */
  allEntities?: { id: string; name: string }[];
};

const VIS_ICON: Record<PropVisRule['level'], string> = {
  public: '🌐', private: '🔒', entities: '👥',
};

export default function EntityPropertyList({
  entityId,
  properties,
  updateEntity,
  inlineEditFields,
  toggleInlineEdit,
  setEditingField,
  fieldStyle,
  sectionLabel,
  onAdd,
  allEntities = [],
}: EntityPropertyListProps) {
  const { t } = useTranslation();
  const propertyEntries = getOrderedPropertyEntries(properties);
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  const [visKey, setVisKey] = useState<string | null>(null);

  const propVisMap = (properties[PROP_VISIBILITY_KEY] as Record<string, PropVisRule>) || {};

  const setPropVis = (key: string, rule: PropVisRule | null) => {
    const base = propertiesRef.current || {};
    const map = { ...((base[PROP_VISIBILITY_KEY] as Record<string, PropVisRule>) || {}) };
    if (rule === null || rule.level === 'public') delete map[key];
    else map[key] = rule;
    updateEntity(entityId, { properties: { ...base, [PROP_VISIBILITY_KEY]: map } });
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const overIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setOver = (index: number | null) => {
    overIndexRef.current = index;
    setOverIndex(index);
  };

  const commitReorder = useCallback((from: number, to: number) => {
    const base = propertiesRef.current || {};
    const entries = getOrderedPropertyEntries(base);
    const reordered = reorderPropertyEntries(entries, from, to);
    updateEntity(entityId, { properties: buildPropertiesWithOrder(reordered, base) });
  }, [entityId, updateEntity]);

  const endDrag = useCallback(() => {
    const from = dragIndexRef.current;
    const to = overIndexRef.current;
    dragIndexRef.current = null;
    setDragIndex(null);
    setOver(null);
    if (from !== null && to !== null && from !== to) {
      commitReorder(from, to);
    }
  }, [commitReorder]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const list = listRef.current;
    if (!list || dragIndexRef.current === null) return;
    const rows = list.querySelectorAll<HTMLElement>('[data-prop-row]');
    let found: number | null = null;
    rows.forEach((row, i) => {
      const rect = row.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) found = i;
    });
    setOver(found);
  }, []);

  const onPointerUp = useCallback(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    endDrag();
  }, [onPointerMove, endDrag]);

  const onGripPointerDown = (e: React.PointerEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragIndexRef.current = index;
    setDragIndex(index);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handlePropertyChange = (key: string, value: string) => {
    updateEntity(entityId, { properties: { ...propertiesRef.current, [key]: value } });
  };

  const handleDeleteProperty = (key: string) => {
    if (!confirm(t('propList.deleteConfirm', { key }))) return;
    const entries = getOrderedPropertyEntries(propertiesRef.current).filter(([k]) => k !== key);
    updateEntity(entityId, { properties: buildPropertiesWithOrder(entries, propertiesRef.current) });
  };

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mt-border-soft)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={sectionLabel}>{t('propList.title')}</span>
        <button className="mt-btn" onClick={onAdd} style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--mt-border)' }}>{t('propList.add')}</button>
      </div>
      {propertyEntries.length > 1 && (
        <div style={{ fontSize: 10, color: 'var(--mt-text-faint)', marginBottom: 6 }}>
          {t('propList.dragHint')}
        </div>
      )}
      <div ref={listRef}>
        {propertyEntries.length === 0 && (
          <div style={{ color: 'var(--mt-text-faint)', fontSize: 11 }}>{t('propList.empty')}</div>
        )}
        {propertyEntries.map(([key, value], index) => {
          const isString = typeof value === 'string';
          const isLong = isString && (value as string).length > 80;
          const isDragging = dragIndex === index;
          const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
          return (
            <div
              key={key}
              data-prop-row
              style={{
                marginBottom: 7,
                paddingTop: 4,
                opacity: isDragging ? 0.45 : 1,
                borderTop: isDropTarget ? '2px solid var(--mt-accent)' : '2px solid transparent',
                transition: 'border-color 0.12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'space-between', marginBottom: 2 }}>
                <span
                  onPointerDown={(e) => onGripPointerDown(e, index)}
                  title={t('propList.dragTip')}
                  style={{
                    cursor: dragIndex !== null ? 'grabbing' : 'grab',
                    color: 'var(--mt-text-faint)',
                    fontSize: 11,
                    lineHeight: 1,
                    padding: '0 2px',
                    userSelect: 'none',
                    flexShrink: 0,
                    touchAction: 'none',
                  }}
                >
                  ⋮⋮
                </span>
                <span style={{ color: 'var(--mt-text-muted)', fontSize: 10, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{key}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="mt-btn"
                    style={{
                      fontSize: 9, padding: '0 5px', height: 16,
                      color: (propVisMap[key]?.level ?? 'public') === 'public' ? 'var(--mt-text-faint)' : 'var(--mt-accent)',
                    }}
                    onClick={() => setVisKey(visKey === key ? null : key)}
                    title={t('propList.visTip', { level: propVisMap[key]?.level === 'private' ? t('propList.levelPrivate') : propVisMap[key]?.level === 'entities' ? t('propList.levelEntities') : t('propList.levelPublic') })}
                  >
                    {VIS_ICON[propVisMap[key]?.level ?? 'public']}
                  </button>
                  {isLong && (
                    <button
                      className="mt-btn"
                      style={{ fontSize: 9, padding: '0 5px', height: 16, color: 'var(--mt-text-muted)' }}
                      onClick={() => toggleInlineEdit(key)}
                      title={inlineEditFields.has(key) ? t('propList.editDone') : t('propList.editSource')}
                    >
                      {inlineEditFields.has(key) ? t('propList.done') : t('propList.edit')}
                    </button>
                  )}
                  {isString && (
                    <button
                      className="mt-btn"
                      style={{ fontSize: 9, padding: '0 5px', height: 16, color: 'var(--mt-accent)' }}
                      onClick={() => setEditingField(key)}
                      title={t('propList.expandTip')}
                    >
                      {t('propList.expand')}
                    </button>
                  )}
                  <button
                    className="mt-btn"
                    style={{ fontSize: 9, padding: '0 5px', height: 16, color: '#c0392b' }}
                    onClick={() => handleDeleteProperty(key)}
                    title={t('propList.deleteTip')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {isLong ? (
                inlineEditFields.has(key) ? (
                  <ImeTextarea
                    value={value as string}
                    onCommit={(v) => handlePropertyChange(key, v)}
                    rows={8}
                    style={fieldStyle}
                  />
                ) : (
                  <Markdown
                    style={{ fontSize: 12, lineHeight: 1.6, padding: '6px 8px', border: '1px solid var(--mt-border-soft)', borderRadius: 4, background: 'var(--mt-panel-header-2)' }}
                  >
                    {value as string}
                  </Markdown>
                )
              ) : (
                <ImeInput
                  value={String(value)}
                  onCommit={(v) => handlePropertyChange(key, v)}
                  style={fieldStyle}
                />
              )}

              {visKey === key && (
                <div style={{
                  marginTop: 5, padding: 7, borderRadius: 4,
                  border: '1px solid var(--mt-accent)', background: 'var(--mt-sel-fill)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--mt-text-muted)', marginBottom: 4 }}>{t('propList.whoCanSee')}</div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {(['public', 'private', 'entities'] as const).map((lvl) => {
                      const active = (propVisMap[key]?.level ?? 'public') === lvl;
                      return (
                        <button
                          key={lvl}
                          className={`mt-btn${active ? ' active' : ''}`}
                          style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${active ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
                          onClick={() => setPropVis(key, lvl === 'entities'
                            ? { level: 'entities', entities: propVisMap[key]?.entities ?? [] }
                            : { level: lvl })}
                        >
                          {VIS_ICON[lvl]} {lvl === 'public' ? t('propList.levelPublic') : lvl === 'private' ? t('propList.levelPrivate') : t('propList.levelEntitiesShort')}
                        </button>
                      );
                    })}
                  </div>
                  {(propVisMap[key]?.level === 'entities') && (
                    <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--mt-border-soft)', borderRadius: 3, background: '#fff', padding: 4 }}>
                      {allEntities.length === 0 && (
                        <div style={{ fontSize: 10, color: 'var(--mt-text-faint)' }}>{t('propList.noOtherEntities')}</div>
                      )}
                      {allEntities.map((e) => {
                        const checked = (propVisMap[key]?.entities ?? []).includes(e.id);
                        return (
                          <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '1px 2px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const cur = propVisMap[key]?.entities ?? [];
                                const next = checked ? cur.filter((x) => x !== e.id) : [...cur, e.id];
                                setPropVis(key, { level: 'entities', entities: next });
                              }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
