import { useTranslation } from 'react-i18next';
import { useSimStore } from '../../stores/simStore';

/**
 * Replay scrubber. Drag to inspect a past tick (sets `scrubTick`); the feed
 * scrolls to and highlights that tick. "最新" snaps back to the live tail.
 */
export default function TickTimeline() {
  const { t } = useTranslation();
  const sim = useSimStore((s) => s.sim);
  const ticks = useSimStore((s) => s.ticks);
  const scrubTick = useSimStore((s) => s.scrubTick);
  const setScrubTick = useSimStore((s) => s.setScrubTick);

  const maxTick = sim?.current_tick ?? 0;
  if (!sim || maxTick < 1 || ticks.length === 0) return null;

  const pos = scrubTick ?? maxTick;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px', borderTop: '1px solid var(--mt-border)',
      background: 'var(--mt-panel-header)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--mt-text-muted)', whiteSpace: 'nowrap' }}>
        {t('tickTimeline.replay')} <b style={{ color: 'var(--mt-accent-dark)' }}>t{pos}</b> / {maxTick}
      </span>
      <input
        type="range"
        min={1}
        max={maxTick}
        value={pos}
        onChange={(e) => {
          const v = Number(e.target.value);
          setScrubTick(v >= maxTick ? null : v);
        }}
        style={{ flex: 1, accentColor: 'var(--mt-accent)' }}
      />
      <button
        className="mt-btn"
        style={{ fontSize: 10, padding: '2px 8px' }}
        disabled={scrubTick == null}
        onClick={() => setScrubTick(null)}
        title={t('tickTimeline.toLatestTip')}
      >
        {t('tickTimeline.latest')}
      </button>
    </div>
  );
}
