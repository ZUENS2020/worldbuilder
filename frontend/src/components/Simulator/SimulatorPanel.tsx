import { useEffect } from 'react';
import { useSimStore } from '../../stores/simStore';
import { useAppStore } from '../../stores/appStore';
import InteractionFeed from './InteractionFeed';

export default function SimulatorPanel() {
  const { sims, sim, stepping, error, loadSims, selectSim, createSim, step, reset } = useSimStore();
  const projectId = useAppStore((s) => s.project?.id);

  // Reload the simulation list whenever the active project changes.
  useEffect(() => {
    reset();
    if (projectId) loadSims();
  }, [projectId, loadSims, reset]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '8px 12px', borderBottom: '1px solid var(--mt-border)',
        background: 'linear-gradient(var(--mt-panel-header-2), var(--mt-panel-header))',
      }}>
        {sims.length > 0 && (
          <select
            value={sim?.id || ''}
            onChange={(e) => selectSim(e.target.value)}
            style={{
              fontSize: 12, padding: '3px 6px', borderRadius: 4,
              border: '1px solid var(--mt-border)', background: '#fff', color: 'var(--mt-text)',
            }}
          >
            {sims.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.driver_mode} · t{s.current_tick}）
              </option>
            ))}
          </select>
        )}

        <button
          className="mt-btn"
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={() => createSim('hybrid')}
        >
          ＋ 新建模拟
        </button>

        {sim && (
          <>
            <button
              className="mt-btn active"
              style={{ fontSize: 12, padding: '4px 14px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
              onClick={() => step()}
              disabled={stepping}
            >
              {stepping ? '推进中…' : '单步推进 ⏭'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--mt-text-muted)' }}>
              当前 Tick：<b>{sim.current_tick}</b> · 驱动：{sim.driver_mode}
            </span>
          </>
        )}

        {error && (
          <span style={{ fontSize: 11, color: '#c0392b', marginLeft: 'auto' }}>⚠️ {error}</span>
        )}
      </div>

      {/* Feed */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {!sim ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
            还没有模拟。点击「＋ 新建模拟」创建一个，然后单步推进让角色网络自行演化。
          </div>
        ) : (
          <InteractionFeed />
        )}
      </div>
    </div>
  );
}
