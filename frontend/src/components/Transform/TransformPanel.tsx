import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, getGraphHops } from '../../types';
import type { TransformDef } from '../../types';

/** Docked Transform panel — lives in the Inspector tab bar, not a floating overlay. */
export default function TransformPanel() {
  const {
    project, selectedEntityId, entities, transforms, loadTransforms,
    executeTransform, executeAllGraphTransforms, removeEntity,
    explorationMode, isolateSubgraph, unpinEntity,
    activeTransformHighlight, clearTransformHighlight,
  } = useAppStore();

  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [emptyHint, setEmptyHint] = useState(false);

  const entity = entities.find((e) => e.id === selectedEntityId);
  const isolateHop = getGraphHops(project).isolate_subgraph;

  useEffect(() => {
    if (entity) {
      loadTransforms(entity.type);
      setResult(null);
      setEmptyHint(false);
    }
  }, [entity?.id, entity?.type, loadTransforms]);

  if (!entity) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mt-text-muted)', fontSize: 12, textAlign: 'center', padding: 16 }}>
        <div>
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>🕸️</div>
          选择一个实体后在此运行 Transform<br />
          <span style={{ fontSize: 11 }}>右键节点可快速切到此面板</span>
        </div>
      </div>
    );
  }

  const config = ENTITY_CONFIG[entity.type] || ENTITY_CONFIG.character;
  const entityId = entity.id;

  const handleTransform = async (transform: TransformDef) => {
    setExecuting(transform.id);
    setResult(null);
    setEmptyHint(false);
    try {
      const res = await executeTransform(entityId, transform.id);
      if (res) setResult({ type: 'success', message: res.message });
      const isGraph = !transform.id.startsWith('ai_');
      if (res && isGraph && (res.new_entities?.length ?? 0) === 0) {
        setEmptyHint(true);
      }
    } catch (e: unknown) {
      setResult({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    setExecuting(null);
  };

  const runAllGraph = async () => {
    setExecuting('__all__');
    setResult(null);
    setEmptyHint(false);
    try {
      const res = await executeAllGraphTransforms(entityId);
      if (res) setResult({ type: 'success', message: res.message });
    } catch (e: unknown) {
      setResult({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    setExecuting(null);
  };

  const handleDelete = async () => {
    if (confirm(`确定删除「${entity.name}」？`)) {
      await removeEntity(entity.id);
    }
  };

  const graphTransforms = transforms.filter((t) => !t.id.startsWith('ai_'));
  const aiTransforms = transforms.filter((t) => t.id.startsWith('ai_'));

  const Row = (t: TransformDef) => {
    const isAI = t.id.startsWith('ai_');
    const running = executing === t.id || executing === '__all__';
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
          {executing === t.id ? <span className="mt-spin">⏳</span> : isAI ? '🤖' : '▸'}
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Entity header */}
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

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
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
            <span style={{ color: '#2faa5e' }}>
              {executing === '__all__' ? <span className="mt-spin">⏳</span> : '▶'}
            </span>
            运行全部展开 Transform
          </div>
        )}

        {transforms.length === 0 && (
          <div style={{ padding: '8px 12px', color: 'var(--mt-text-muted)', fontSize: 11 }}>加载中...</div>
        )}

        {graphTransforms.length > 0 && sectionHeader('图谱展开 Graph')}
        {graphTransforms.map(Row)}

        {aiTransforms.length > 0 && sectionHeader('AI Transform')}
        {aiTransforms.map(Row)}

        {emptyHint && (
          <div
            style={{
              margin: '6px 8px', padding: '8px 10px', borderRadius: 5,
              background: '#fff8e6', border: '1px solid #f0dca0', fontSize: 11,
              color: '#8a6d1a', lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>暂无可展开的关联</div>
            <div style={{ marginBottom: 6, color: '#9a7d2a' }}>这个实体在该方向上还没有记录关系。</div>
            {aiTransforms.some((t) => t.id === 'ai_infer') && (
              <button
                className="mt-btn"
                style={{ fontSize: 11, padding: '3px 9px', border: '1px solid #8e5cc4', color: '#8e5cc4', width: '100%' }}
                disabled={!!executing}
                onClick={() => { const t = aiTransforms.find((x) => x.id === 'ai_infer'); if (t) handleTransform(t); }}
              >
                🤖 让 AI 推断潜在关联
              </button>
            )}
          </div>
        )}

        {sectionHeader('画布 Canvas')}
        <div
          onClick={() => isolateSubgraph(entityId)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--mt-text)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          title={`只在画布上保留该节点 ${isolateHop} 跳内的关联，进入探索模式`}
        >
          <span style={{ width: 16, textAlign: 'center', color: 'var(--mt-accent)' }}>🎯</span>
          <span style={{ flex: 1 }}>只看此子图（{isolateHop} 跳）</span>
        </div>
        {explorationMode && (
          <div
            onClick={() => unpinEntity(entityId)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--mt-text)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            title="从画布隐藏此节点（不会删除数据）"
          >
            <span style={{ width: 16, textAlign: 'center', color: 'var(--mt-text-muted)' }}>🫥</span>
            <span style={{ flex: 1 }}>从画布隐藏</span>
          </div>
        )}

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
              margin: '8px', padding: '6px 9px', borderRadius: 4, fontSize: 11,
              background: result.type === 'success' ? '#eafaf0' : '#fdecea',
              color: result.type === 'success' ? '#1f7a3d' : '#c0392b',
              border: `1px solid ${result.type === 'success' ? '#bfe6cd' : '#f3c6c0'}`,
              whiteSpace: 'pre-wrap',
            }}
          >
            {result.type === 'success' ? '✅ ' : '❌ '}{result.message}
          </div>
        )}

        {activeTransformHighlight && (
          <div style={{ margin: '0 8px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--mt-text-muted)', flex: 1 }}>
              高亮中 · 点击画布空白处取消
            </span>
            <button
              type="button"
              className="mt-btn"
              style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--mt-border)' }}
              onClick={() => clearTransformHighlight()}
            >
              清除高亮
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
