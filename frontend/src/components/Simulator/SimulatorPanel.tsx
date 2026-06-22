import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSimStore } from '../../stores/simStore';
import { useAppStore } from '../../stores/appStore';
import InteractionFeed from './InteractionFeed';
import BeliefPanel from './BeliefPanel';
import WritebackPanel from './WritebackPanel';
import TickTimeline from './TickTimeline';
import { EVOLUTION_SIM_CONFIG } from '../../constants/evolutionSim';

const NUDGE_KEYS: Record<string, string> = {
  off: 'simulator.nudgeOff',
  random: 'simulator.nudgeRandom',
  targeted: 'simulator.nudgeTargeted',
  weighted: 'simulator.nudgeWeighted',
};

export default function SimulatorPanel() {
  const { t } = useTranslation();
  const {
    sims, sim, stepping, isPlaying, error,
    loadSims, selectSim, createSim, step, play, pause, resetSim, patchConfig, reset,
  } = useSimStore();
  const projectId = useAppStore((s) => s.project?.id);
  const projectName = useAppStore((s) => s.project?.name);
  const [tab, setTab] = useState<'feed' | 'belief' | 'writeback'>('feed');
  const [showSettings, setShowSettings] = useState(false);

  // Reload the simulation list whenever the active project changes.
  useEffect(() => {
    reset();
    if (projectId) loadSims();
  }, [projectId, loadSims, reset]);

  const cfg = sim?.config || {};

  const handleCreateSim = () => {
    const isEvolution = projectName?.includes('演进测试');
    createSim('hybrid', isEvolution ? EVOLUTION_SIM_CONFIG : undefined);
  };

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
          onClick={handleCreateSim}
        >
          {t('simulator.newSim')}
        </button>

        {sim && (
          <>
            {/* Play / Pause the background loop */}
            {isPlaying ? (
              <button
                className="mt-btn active"
                style={{ fontSize: 12, padding: '4px 14px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
                onClick={() => pause()}
              >
                {t('simulator.pause')}
              </button>
            ) : (
              <button
                className="mt-btn active"
                style={{ fontSize: 12, padding: '4px 14px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
                onClick={() => play()}
              >
                {t('simulator.autoEvolve')}
              </button>
            )}
            <button
              className="mt-btn"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => step()}
              disabled={stepping || isPlaying}
              title={t('simulator.stepTip')}
            >
              {stepping ? t('simulator.stepping') : t('simulator.step')}
            </button>
            <button
              className="mt-btn"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => {
                if (confirm(t('simulator.resetConfirm'))) resetSim();
              }}
              disabled={isPlaying}
              title={t('simulator.resetTip')}
            >
              {t('simulator.reset')}
            </button>

            <span style={{ fontSize: 11, color: 'var(--mt-text-muted)' }}>
              Tick <b>{sim.current_tick}</b> · {sim.driver_mode}
              {isPlaying && <span style={{ color: 'var(--mt-accent-dark)' }}>{t('simulator.running')}</span>}
            </span>

            <button
              className={`mt-btn${showSettings ? ' active' : ''}`}
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => setShowSettings((v) => !v)}
              title={t('simulator.settingsTip')}
            >
              {t('simulator.settings')}
            </button>
          </>
        )}

        {sim && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button className={`mt-btn${tab === 'feed' ? ' active' : ''}`} style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab('feed')}>
              {t('simulator.tabFeed')}
            </button>
            <button className={`mt-btn${tab === 'belief' ? ' active' : ''}`} style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab('belief')} title={t('simulator.tabBeliefTip')}>
              {t('simulator.tabBelief')}
            </button>
            <button className={`mt-btn${tab === 'writeback' ? ' active' : ''}`} style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab('writeback')} title={t('simulator.tabWritebackTip')}>
              {t('simulator.tabWriteback')}
            </button>
          </div>
        )}

        {error && (
          <span style={{ fontSize: 11, color: '#c0392b', marginLeft: sim ? 8 : 'auto' }}>⚠️ {error}</span>
        )}
      </div>

      {/* Settings drawer */}
      {sim && showSettings && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          padding: '8px 12px', borderBottom: '1px solid var(--mt-border)',
          background: 'var(--mt-window)', fontSize: 11, color: 'var(--mt-text-muted)',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {t('simulator.driver')}
            <select
              value={sim.driver_mode}
              disabled={isPlaying}
              onChange={(e) => patchConfig({ driver_mode: e.target.value })}
              style={selStyle}
            >
              <option value="hybrid">{t('simulator.driverHybrid')}</option>
              <option value="full_llm">{t('simulator.driverFullLlm')}</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {t('simulator.tempo')}
            <input type="number" min={1} max={120} defaultValue={cfg.tick_interval_sec ?? 6}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { tick_interval_sec: Number(e.target.value) } })}
              style={{ ...selStyle, width: 56 }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={t('simulator.stopAtTickTip')}>
            {t('simulator.stopAtTick')}
            <input type="number" min={0} defaultValue={cfg.max_ticks ?? 0}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { max_ticks: Number(e.target.value) } })}
              style={{ ...selStyle, width: 56 }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={t('simulator.stabilityWindowTip')}>
            {t('simulator.stabilityWindow')}
            <input type="number" min={0} defaultValue={cfg.stability_window ?? 0}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { stability_window: Number(e.target.value) } })}
              style={{ ...selStyle, width: 48 }} />
          </label>

          <span style={{ width: 1, height: 18, background: 'var(--mt-border)' }} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={t('simulator.nudgeTip')}>
            {t('simulator.nudge')}
            <select
              value={cfg.nudge_strategy ?? 'off'}
              disabled={isPlaying}
              onChange={(e) => patchConfig({ config: { nudge_strategy: e.target.value } })}
              style={selStyle}
            >
              {Object.entries(NUDGE_KEYS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>

          {(cfg.nudge_strategy ?? 'off') !== 'off' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={t('simulator.intensityTip')}>
                {t('simulator.intensity')}
                <input type="number" min={0} max={1} step={0.05} defaultValue={cfg.nudge_intensity ?? 0.5}
                  disabled={isPlaying}
                  onBlur={(e) => patchConfig({ config: { nudge_intensity: Number(e.target.value) } })}
                  style={{ ...selStyle, width: 56 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={t('simulator.frequencyTip')}>
                {t('simulator.frequency')}
                <input type="number" min={1} defaultValue={cfg.nudge_every_n_ticks ?? 1}
                  disabled={isPlaying}
                  onBlur={(e) => patchConfig({ config: { nudge_every_n_ticks: Number(e.target.value) } })}
                  style={{ ...selStyle, width: 48 }} />
              </label>
            </>
          )}

          <span style={{ width: 1, height: 18, background: 'var(--mt-border)' }} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={t('simulator.pendingMaxAgeTip')}>
            {t('simulator.pendingMaxAge')}
            <input type="number" min={0} defaultValue={cfg.pending_max_age ?? 8}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { pending_max_age: Number(e.target.value) } })}
              style={{ ...selStyle, width: 48 }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={t('simulator.mixConflictTip')}>
            <input type="checkbox" checked={!!cfg.scheduler_mix_conflict} disabled={isPlaying}
              onChange={(e) => patchConfig({ config: { scheduler_mix_conflict: e.target.checked } })} />
            {t('simulator.mixConflict')}
          </label>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {!sim ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
            {t('simulator.emptyBody')}
          </div>
        ) : tab === 'feed' ? (
          <InteractionFeed />
        ) : tab === 'belief' ? (
          <BeliefPanel />
        ) : (
          <WritebackPanel />
        )}
      </div>

      {/* Replay scrubber */}
      {sim && tab === 'feed' && <TickTimeline />}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  fontSize: 11, padding: '2px 5px', borderRadius: 4,
  border: '1px solid var(--mt-border)', background: '#fff', color: 'var(--mt-text)',
};
