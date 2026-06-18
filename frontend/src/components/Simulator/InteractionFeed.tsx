import { useEffect, useRef } from 'react';
import { useSimStore, type SimTick } from '../../stores/simStore';

/** Render one mutation as a compact, human-readable chip. */
function mutationLabel(m: any): string {
  switch (m.op) {
    case 'update_relation': {
      const bits: string[] = [];
      if (m.type) bits.push(`→ ${m.type}`);
      if (m.weight != null) bits.push(`权重 ${Number(m.weight).toFixed(2)}`);
      return `${m.source} ↔ ${m.target} ${bits.join(' · ')}`.trim();
    }
    case 'create_relation':
      return `新关系 ${m.source} ↔ ${m.target}（${m.type} ${Number(m.weight ?? 0).toFixed(2)}）`;
    case 'update_entity': {
      const p = m.properties || {};
      const bits = Object.entries(p).map(([k, v]) => `${k}=${v}`);
      return `${m.entity}：${bits.join('，')}`;
    }
    case 'create_entity':
      return `新实体 ${m.name}（${m.type}）`;
    case 'create_event':
      return `⚡ 事件「${m.name}」${m.summary ? `：${m.summary}` : ''}`;
    case undefined:
      return JSON.stringify(m);
    default:
      return m.error ? `⚠️ ${m.op}: ${m.error}` : `${m.op}`;
  }
}

function TickCard({ t }: { t: SimTick }) {
  const interactions = Array.isArray(t.interactions) ? t.interactions : [];
  const mutations = Array.isArray(t.mutations) ? t.mutations : [];
  const m = t.metrics || {};
  return (
    <div style={{ borderBottom: '1px solid var(--mt-border)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--mt-accent-dark)',
          background: 'var(--mt-accent-bg)', borderRadius: 3, padding: '1px 7px',
        }}>
          Tick {t.tick}
        </span>
        <span style={{ fontSize: 10, color: 'var(--mt-text-faint)' }}>
          {m.encounters ?? interactions.length} 次相遇 · {mutations.length} 处演化
          {m.latency_ms != null ? ` · ${(m.latency_ms / 1000).toFixed(1)}s` : ''}
        </span>
      </div>

      {interactions.map((sc: any, i: number) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mt-text-muted)', marginBottom: 2 }}>
            {(sc.participants || []).join(' × ')}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--mt-text)', whiteSpace: 'pre-wrap' }}>
            {sc.narrative}
          </div>
        </div>
      ))}

      {mutations.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {mutations.map((mu: any, i: number) => (
            <span key={i} style={{
              fontSize: 10,
              color: mu.error ? '#c0392b' : mu.op === 'create_event' ? '#b3690f' : 'var(--mt-text-muted)',
              background: mu.op === 'create_event' ? '#fdf2e2' : 'var(--mt-window)',
              border: `1px solid ${mu.op === 'create_event' ? '#e8b877' : 'var(--mt-border)'}`,
              borderRadius: 3, padding: '1px 6px',
            }}>
              {mutationLabel(mu)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InteractionFeed() {
  const ticks = useSimStore((s) => s.ticks);
  const stepping = useSimStore((s) => s.stepping);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [ticks.length, stepping]);

  if (ticks.length === 0 && !stepping) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
        还没有世界事件。点击「单步推进 ⏭」让角色们开始互动。
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {ticks.map((t) => <TickCard key={t.id} t={t} />)}
      {stepping && (
        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--mt-text-muted)', fontSize: 12 }}>
          ⏳ 角色们正在互动，世界正在演化…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
