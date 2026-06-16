import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG } from '../../types';
import type { TransformDef } from '../../types';

export default function ContextMenu() {
  const {
    contextMenu, setContextMenu, transforms, loadTransforms,
    executeTransform, selectedEntityId, entities, removeEntity,
  } = useAppStore();
  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (contextMenu && selectedEntityId) {
      const entity = entities.find((e) => e.id === selectedEntityId);
      if (entity) loadTransforms(entity.type);
    }
  }, [contextMenu, selectedEntityId]);

  if (!contextMenu) return null;
  const entity = entities.find((e) => e.id === contextMenu.entityId);
  if (!entity) return null;
  const config = ENTITY_CONFIG[entity.type] || ENTITY_CONFIG.character;

  const handleTransform = async (transform: TransformDef) => {
    setExecuting(transform.id);
    setResult(null);
    try {
      const res = await executeTransform(contextMenu.entityId, transform.id);
      if (res) setResult({ type: 'success', message: res.message });
    } catch (e: any) {
      setResult({ type: 'error', message: e.message });
    }
    setExecuting(null);
  };

  const runAllGraph = async () => {
    const graphTransforms = transforms.filter((t) => !t.id.startsWith('ai_'));
    setResult(null);
    for (const t of graphTransforms) {
      setExecuting(t.id);
      try { await executeTransform(contextMenu.entityId, t.id); } catch { /* keep going */ }
    }
    setExecuting(null);
    setResult({ type: 'success', message: `已运行 ${graphTransforms.length} 个展开 Transform` });
  };

  const handleDelete = async () => {
    if (confirm(`确定删除「${entity.name}」？`)) {
      await removeEntity(entity.id);
      setContextMenu(null);
    }
  };

  const graphTransforms = transforms.filter((t) => !t.id.startsWith('ai_'));
  const aiTransforms = transforms.filter((t) => t.id.startsWith('ai_'));

  const Row = (t: TransformDef) => {
    const isAI = t.id.startsWith('ai_');
    const running = executing === t.id;
    return (
      <div
        key={t.id}
        onClick={() => !executing && handleTransform(t)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 12px', cursor: executing ? 'wait' : 'pointer',
          fontSize: 12, color: 'var(--mt-text)', opacity: running ? 0.6 : 1,
        }}
        onMouseEnter={(e) => { if (!executing) (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        title={t.description}
      >
        <span style={{ width: 16, textAlign: 'center', color: isAI ? '#8e5cc4' : '#2faa5e' }}>
          {running ? <span className="mt-spin">⏳</span> : isAI ? '🤖' : '▸'}
        </span>
        <span style={{ flex: 1 }}>{t.label}</span>
      </div>
    );
  };

  const sectionHeader = (text: string) => (
    <div
      style={{
        padding: '4px 12px', fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
        color: '#666', textTransform: 'uppercase',
        background: 'linear-gradient(var(--mt-panel-header-2), var(--mt-panel-header))',
        borderTop: '1px solid var(--mt-border-soft)', borderBottom: '1px solid var(--mt-border-soft)',
      }}
    >
      {text}
    </div>
  );

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => { setResult(null); setContextMenu(null); }} />
      <div
        style={{
          position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 999,
          background: 'var(--mt-panel)', border: '1px solid var(--mt-border)', borderRadius: 5,
          minWidth: 248, maxWidth: 300, maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 6px 22px rgba(0,0,0,0.22)', paddingBottom: 4,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderBottom: '1px solid var(--mt-border)' }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: 6, background: '#fff',
              border: `1px solid ${config.color}`, borderBottom: `2px solid ${config.color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}
          >
            {config.icon}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entity.name}</div>
            <div style={{ color: config.color, fontSize: 10 }}>{config.label}</div>
          </div>
        </div>

        {/* Run all */}
        {graphTransforms.length > 0 && (
          <div
            onClick={() => !executing && runAllGraph()}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
              cursor: executing ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, color: '#1f7a3d',
              borderBottom: '1px solid var(--mt-border-soft)',
            }}
            onMouseEnter={(e) => { if (!executing) (e.currentTarget as HTMLDivElement).style.background = '#eafaf0'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <span style={{ color: '#2faa5e' }}>▶</span> 运行全部展开 Transform
          </div>
        )}

        {transforms.length === 0 && <div style={{ padding: '8px 12px', color: 'var(--mt-text-muted)', fontSize: 11 }}>加载中...</div>}

        {graphTransforms.length > 0 && sectionHeader('图谱展开 Graph')}
        {graphTransforms.map(Row)}

        {aiTransforms.length > 0 && sectionHeader('AI Transform')}
        {aiTransforms.map(Row)}

        {/* Delete */}
        <div style={{ borderTop: '1px solid var(--mt-border-soft)', marginTop: 2 }}>
          <div
            onClick={handleDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#c0392b' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#fdecea'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            🗑️ 删除实体
          </div>
        </div>

        {result && (
          <div
            style={{
              margin: '4px 8px 0', padding: '6px 9px', borderRadius: 4, fontSize: 11,
              background: result.type === 'success' ? '#eafaf0' : '#fdecea',
              color: result.type === 'success' ? '#1f7a3d' : '#c0392b',
              border: `1px solid ${result.type === 'success' ? '#bfe6cd' : '#f3c6c0'}`,
              whiteSpace: 'pre-wrap',
            }}
          >
            {result.type === 'success' ? '✅ ' : '❌ '}{result.message}
          </div>
        )}
      </div>
    </>
  );
}
