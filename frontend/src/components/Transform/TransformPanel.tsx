import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, getGraphHops } from '../../types';
import type { TransformDef } from '../../types';

/** Docked Transform panel — lives in the Inspector tab bar, not a floating overlay. */
export default function TransformPanel() {
  const { t: tr } = useTranslation();
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
          {tr('transform.emptyTitle')}<br />
          <span style={{ fontSize: 11 }}>{tr('transform.emptyHint')}</span>
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
    if (confirm(tr('transform.deleteConfirm', { name: entity.name }))) {
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
        <span style={{ flex: 1 }}>{tr(t.label)}</span>
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
          <div style={{ color: config.color, fontSize: 10 }}>{tr(config.label)}</div>
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
            {tr('transform.runAllExpand')}
          </div>
        )}

        {transforms.length === 0 && (
          <div style={{ padding: '8px 12px', color: 'var(--mt-text-muted)', fontSize: 11 }}>{tr('common.loading')}</div>
        )}

        {graphTransforms.length > 0 && sectionHeader(tr('transform.sectionGraph'))}
        {graphTransforms.map(Row)}

        {aiTransforms.length > 0 && sectionHeader(tr('transform.sectionAI'))}
        {aiTransforms.map(Row)}

        {emptyHint && (
          <div
            style={{
              margin: '6px 8px', padding: '8px 10px', borderRadius: 5,
              background: '#fff8e6', border: '1px solid #f0dca0', fontSize: 11,
              color: '#8a6d1a', lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{tr('transform.noRelationsTitle')}</div>
            <div style={{ marginBottom: 6, color: '#9a7d2a' }}>{tr('transform.noRelationsHint')}</div>
            {aiTransforms.some((t) => t.id === 'ai_infer') && (
              <button
                className="mt-btn"
                style={{ fontSize: 11, padding: '3px 9px', border: '1px solid #8e5cc4', color: '#8e5cc4', width: '100%' }}
                disabled={!!executing}
                onClick={() => { const t = aiTransforms.find((x) => x.id === 'ai_infer'); if (t) handleTransform(t); }}
              >
                {tr('transform.aiInferBtn')}
              </button>
            )}
          </div>
        )}

        {sectionHeader(tr('transform.sectionCanvas'))}
        <div
          onClick={() => isolateSubgraph(entityId)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--mt-text)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          title={tr('transform.isolateTip', { hops: isolateHop })}
        >
          <span style={{ width: 16, textAlign: 'center', color: 'var(--mt-accent)' }}>🎯</span>
          <span style={{ flex: 1 }}>{tr('transform.isolateLabel', { hops: isolateHop })}</span>
        </div>
        {explorationMode && (
          <div
            onClick={() => unpinEntity(entityId)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--mt-text)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-btn-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            title={tr('transform.hideTip')}
          >
            <span style={{ width: 16, textAlign: 'center', color: 'var(--mt-text-muted)' }}>🫥</span>
            <span style={{ flex: 1 }}>{tr('transform.hideLabel')}</span>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--mt-border-soft)', marginTop: 2 }}>
          <div
            onClick={handleDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#c0392b' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#fdecea'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            {tr('transform.deleteEntity')}
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
              {tr('transform.highlighting')}
            </span>
            <button
              type="button"
              className="mt-btn"
              style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--mt-border)' }}
              onClick={() => clearTransformHighlight()}
            >
              {tr('transform.clearHighlight')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
