import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSimStore, type SimTick } from '../../stores/simStore';

/** Render one mutation as a compact, human-readable chip. */
function mutationLabel(m: any, tr: (k: string, o?: any) => string): string {
  switch (m.op) {
    case 'update_relation': {
      const bits: string[] = [];
      if (m.type) bits.push(`→ ${m.type}`);
      if (m.weight != null) bits.push(tr('feed.weight', { w: Number(m.weight).toFixed(2) }));
      return `${m.source} ↔ ${m.target} ${bits.join(' · ')}`.trim();
    }
    case 'create_relation':
      return tr('feed.newRelation', { source: m.source, target: m.target, type: m.type, weight: Number(m.weight ?? 0).toFixed(2) });
    case 'update_entity': {
      const p = m.properties || {};
      const bits = Object.entries(p).map(([k, v]) => `${k}=${v}`);
      return tr('feed.updateEntity', { entity: m.entity, bits: bits.join('，') });
    }
    case 'create_entity':
      return tr('feed.newEntity', { name: m.name, type: m.type });
    case 'create_event':
      return m.summary ? tr('feed.eventWith', { name: m.name, summary: m.summary }) : tr('feed.eventBare', { name: m.name });
    case 'register_pending_event':
      return m.stakes ? tr('feed.pendingWith', { name: m.name, stakes: m.stakes }) : tr('feed.pendingBare', { name: m.name });
    case 'resolve_event':
      return m.outcome ? tr('feed.resolveWith', { name: m.name, outcome: m.outcome }) : tr('feed.resolveBare', { name: m.name });
    case undefined:
      return JSON.stringify(m);
    default:
      return m.error ? `⚠️ ${m.op}: ${m.error}` : `${m.op}`;
  }
}

function TickCard({ t, highlight }: { t: SimTick; highlight?: boolean }) {
  const { t: tr } = useTranslation();
  const interactions = Array.isArray(t.interactions) ? t.interactions : [];
  const mutations = Array.isArray(t.mutations) ? t.mutations : [];
  const m = t.metrics || {};
  return (
    <div
      data-tick={t.tick}
      style={{
        borderBottom: '1px solid var(--mt-border)', padding: '10px 12px',
        background: highlight ? 'var(--mt-accent-bg)' : undefined,
        transition: 'background 0.25s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--mt-accent-dark)',
          background: 'var(--mt-accent-bg)', borderRadius: 3, padding: '1px 7px',
        }}>
          Tick {t.tick}
        </span>
        <span style={{ fontSize: 10, color: 'var(--mt-text-faint)' }}>
          {tr('feed.encounters', { enc: m.encounters ?? interactions.length, mut: mutations.length })}
          {m.resolved_events ? tr('feed.resolvedSuffix', { n: m.resolved_events }) : ''}
          {m.pending_registered ? tr('feed.pendingSuffix', { n: m.pending_registered }) : ''}
          {m.pending_registered_from_drought ? tr('feed.droughtSuffix', { n: m.pending_registered_from_drought }) : ''}
          {m.dedupe_llm_skipped ? tr('feed.dedupeSuffix', { n: m.dedupe_llm_skipped }) : ''}
          {m.pending_drought ? tr('feed.pendingDrought') : ''}
          {m.oracle_fallback ? tr('feed.oracleFallback', { n: m.oracle_fallback }) : ''}
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
          {mutations.map((mu: any, i: number) => {
            const isEvent = mu.op === 'create_event';
            const isPending = mu.op === 'register_pending_event';
            const isResolve = mu.op === 'resolve_event';
            let color = 'var(--mt-text-muted)';
            let bg = 'var(--mt-window)';
            let border = 'var(--mt-border)';
            if (mu.error) { color = '#c0392b'; }
            else if (isResolve) { color = '#1f7a4d'; bg = '#e6f6ec'; border = '#9bd3b4'; }
            else if (isPending) { color = '#5a4ba8'; bg = '#efecfb'; border = '#c3b8ec'; }
            else if (isEvent) { color = '#b3690f'; bg = '#fdf2e2'; border = '#e8b877'; }
            return (
              <span key={i} style={{
                fontSize: 10, color, background: bg,
                border: `1px solid ${border}`, borderRadius: 3, padding: '1px 6px',
              }}>
                {mutationLabel(mu, tr)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function InteractionFeed() {
  const { t: tr } = useTranslation();
  const ticks = useSimStore((s) => s.ticks);
  const stepping = useSimStore((s) => s.stepping);
  const scrubTick = useSimStore((s) => s.scrubTick);
  const pauseNotice = useSimStore((s) => s.pauseNotice);
  const lastTickId = ticks[ticks.length - 1]?.id;
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scrubbing pauses the live auto-scroll; jump to the inspected tick instead.
    if (scrubTick != null) {
      scrollRef.current
        ?.querySelector(`[data-tick="${scrubTick}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [ticks.length, lastTickId, stepping, scrubTick]);

  if (ticks.length === 0 && !stepping) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
        {tr('feed.empty')}
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto' }}>
      {ticks.map((t) => <TickCard key={t.id} t={t} highlight={scrubTick === t.tick} />)}
      {stepping && (
        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--mt-text-muted)', fontSize: 12 }}>
          {tr('feed.evolving')}
        </div>
      )}
      {pauseNotice && !stepping && (
        <div style={{
          margin: '14px 12px', padding: '12px 14px', textAlign: 'center',
          border: '1px solid var(--mt-border)', borderRadius: 6,
          background: 'var(--mt-window)', color: 'var(--mt-text-muted)', fontSize: 12.5,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--mt-text)', marginBottom: 2 }}>{tr('feed.curtain')}</div>
          {pauseNotice.reason === 'quiescent'
            ? tr('feed.quiescent', { tick: pauseNotice.tick })
            : tr('feed.maxTicks', { tick: pauseNotice.tick })}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
