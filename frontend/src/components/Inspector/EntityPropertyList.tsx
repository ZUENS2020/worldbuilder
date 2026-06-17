import { useCallback, useRef, useState } from 'react';
import { ImeInput, ImeTextarea } from '../common/ImeInput';
import Markdown from '../common/Markdown';
import {
  buildPropertiesWithOrder,
  getOrderedPropertyEntries,
  reorderPropertyEntries,
} from '../../utils/propertyOrder';

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
}: EntityPropertyListProps) {
  const propertyEntries = getOrderedPropertyEntries(properties);
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

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
    if (!confirm(`删除属性「${key}」？`)) return;
    const entries = getOrderedPropertyEntries(propertiesRef.current).filter(([k]) => k !== key);
    updateEntity(entityId, { properties: buildPropertiesWithOrder(entries, propertiesRef.current) });
  };

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mt-border-soft)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={sectionLabel}>属性 Properties</span>
        <button className="mt-btn" onClick={onAdd} style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--mt-border)' }}>＋ 添加</button>
      </div>
      {propertyEntries.length > 1 && (
        <div style={{ fontSize: 10, color: 'var(--mt-text-faint)', marginBottom: 6 }}>
          拖拽 ⋮⋮ 调整顺序
        </div>
      )}
      <div ref={listRef}>
        {propertyEntries.length === 0 && (
          <div style={{ color: 'var(--mt-text-faint)', fontSize: 11 }}>（暂无属性）</div>
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
                  title="拖拽调整顺序"
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
                  {isLong && (
                    <button
                      className="mt-btn"
                      style={{ fontSize: 9, padding: '0 5px', height: 16, color: 'var(--mt-text-muted)' }}
                      onClick={() => toggleInlineEdit(key)}
                      title={inlineEditFields.has(key) ? '完成编辑（显示渲染）' : '内联编辑源码'}
                    >
                      {inlineEditFields.has(key) ? '✓ 完成' : '✎ 编辑'}
                    </button>
                  )}
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
                  <button
                    className="mt-btn"
                    style={{ fontSize: 9, padding: '0 5px', height: 16, color: '#c0392b' }}
                    onClick={() => handleDeleteProperty(key)}
                    title="删除属性"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
