import { useEffect, useState } from 'react';
import { useSimStore } from '../../stores/simStore';
import { useAppStore } from '../../stores/appStore';
import InteractionFeed from './InteractionFeed';
import BeliefPanel from './BeliefPanel';
import WritebackPanel from './WritebackPanel';
import TickTimeline from './TickTimeline';

const NUDGE_LABELS: Record<string, string> = {
  off: '关闭',
  random: '随机',
  targeted: '指定',
  weighted: '按人脉',
};

export default function SimulatorPanel() {
  const {
    sims, sim, stepping, isPlaying, error,
    loadSims, selectSim, createSim, step, play, pause, resetSim, patchConfig, reset,
  } = useSimStore();
  const projectId = useAppStore((s) => s.project?.id);
  const [tab, setTab] = useState<'feed' | 'belief' | 'writeback'>('feed');
  const [showSettings, setShowSettings] = useState(false);

  // Reload the simulation list whenever the active project changes.
  useEffect(() => {
    reset();
    if (projectId) loadSims();
  }, [projectId, loadSims, reset]);

  const cfg = sim?.config || {};

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
            {/* Play / Pause the background loop */}
            {isPlaying ? (
              <button
                className="mt-btn active"
                style={{ fontSize: 12, padding: '4px 14px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
                onClick={() => pause()}
              >
                ⏸ 暂停
              </button>
            ) : (
              <button
                className="mt-btn active"
                style={{ fontSize: 12, padding: '4px 14px', fontWeight: 600, border: '1px solid var(--mt-accent)' }}
                onClick={() => play()}
              >
                ▶ 自动演化
              </button>
            )}
            <button
              className="mt-btn"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => step()}
              disabled={stepping || isPlaying}
              title="推进一个 tick"
            >
              {stepping ? '推进中…' : '单步 ⏭'}
            </button>
            <button
              className="mt-btn"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => {
                if (confirm('重置会把世界恢复到这个模拟创建时的初始状态，并清空所有 tick、信念与记忆。确定？')) resetSim();
              }}
              disabled={isPlaying}
              title="恢复到 tick 0 的世界基线"
            >
              ↺ 重置
            </button>

            <span style={{ fontSize: 11, color: 'var(--mt-text-muted)' }}>
              Tick <b>{sim.current_tick}</b> · {sim.driver_mode}
              {isPlaying && <span style={{ color: 'var(--mt-accent-dark)' }}> · 运行中</span>}
            </span>

            <button
              className={`mt-btn${showSettings ? ' active' : ''}`}
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => setShowSettings((v) => !v)}
              title="驱动模式、节奏、停止条件与启发式扰动"
            >
              ⚙ 设置
            </button>
          </>
        )}

        {sim && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button className={`mt-btn${tab === 'feed' ? ' active' : ''}`} style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab('feed')}>
              世界事件
            </button>
            <button className={`mt-btn${tab === 'belief' ? ' active' : ''}`} style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab('belief')} title="对照某角色的信念副本与世界真相">
              信念 / 真相
            </button>
            <button className={`mt-btn${tab === 'writeback' ? ' active' : ''}`} style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab('writeback')} title="审阅 SillyTavern 对话待回写队列">
              ST 回写
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
            驱动
            <select
              value={sim.driver_mode}
              disabled={isPlaying}
              onChange={(e) => patchConfig({ driver_mode: e.target.value })}
              style={selStyle}
            >
              <option value="hybrid">hybrid（机制+LLM）</option>
              <option value="full_llm">full_llm（全 LLM）</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            节奏(秒)
            <input type="number" min={1} max={120} defaultValue={cfg.tick_interval_sec ?? 6}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { tick_interval_sec: Number(e.target.value) } })}
              style={{ ...selStyle, width: 56 }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="到达该 tick 自动暂停（0=不限）">
            止于 tick
            <input type="number" min={0} defaultValue={cfg.max_ticks ?? 0}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { max_ticks: Number(e.target.value) } })}
              style={{ ...selStyle, width: 56 }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="连续 N 个 tick 无变化则自动暂停（0=关闭）">
            稳定窗
            <input type="number" min={0} defaultValue={cfg.stability_window ?? 0}
              disabled={isPlaying}
              onBlur={(e) => patchConfig({ config: { stability_window: Number(e.target.value) } })}
              style={{ ...selStyle, width: 48 }} />
          </label>

          <span style={{ width: 1, height: 18, background: 'var(--mt-border)' }} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="预感扰动：让 Oracle 周期性给某些角色投递模糊直觉">
            扰动
            <select
              value={cfg.nudge_strategy ?? 'off'}
              disabled={isPlaying}
              onChange={(e) => patchConfig({ config: { nudge_strategy: e.target.value } })}
              style={selStyle}
            >
              {Object.entries(NUDGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>

          {(cfg.nudge_strategy ?? 'off') !== 'off' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="模糊程度：越高越清晰">
                强度
                <input type="number" min={0} max={1} step={0.05} defaultValue={cfg.nudge_intensity ?? 0.5}
                  disabled={isPlaying}
                  onBlur={(e) => patchConfig({ config: { nudge_intensity: Number(e.target.value) } })}
                  style={{ ...selStyle, width: 56 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="每隔几个 tick 投递一次">
                频率
                <input type="number" min={1} defaultValue={cfg.nudge_every_n_ticks ?? 1}
                  disabled={isPlaying}
                  onBlur={(e) => patchConfig({ config: { nudge_every_n_ticks: Number(e.target.value) } })}
                  style={{ ...selStyle, width: 48 }} />
              </label>
            </>
          )}

          <span style={{ width: 1, height: 18, background: 'var(--mt-border)' }} />

          {/* Drama controls — switchable mechanisms + master intensity dial */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="戏剧强度总档位：越高，冲突越大胆、转折越剧烈（0~1）">
            🎭 戏剧
            <input type="range" min={0} max={1} step={0.05} defaultValue={cfg.drama_intensity ?? 0.3}
              disabled={isPlaying}
              onChange={(e) => patchConfig({ config: { drama_intensity: Number(e.target.value) } })}
              style={{ width: 90 }} />
            <span style={{ width: 24, textAlign: 'right' }}>{Number(cfg.drama_intensity ?? 0.3).toFixed(2)}</span>
          </label>

          {([
            ['drama_actor', '演员', '让人物主动做出决定性行动/冲突，而非寒暄'],
            ['drama_oracle', '裁决', '放开关系变化幅度，允许决裂/翻脸/剧变一步到位'],
            ['drama_scheduler', '调度', '主动撮合敌对/陌生角色，制造对抗'],
            ['drama_event_injector', '事件', '周期性注入外部突发事件（危机/介入/抉择）'],
            ['drama_tension', '张力', '积压张力到临界则强制爆发'],
            ['drama_director', '导演', '全局导演周期性升级一条冲突弧线'],
          ] as [string, string, string][]).map(([key, label, tip]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={tip}>
              <input type="checkbox" checked={!!cfg[key]} disabled={isPlaying}
                onChange={(e) => patchConfig({ config: { [key]: e.target.checked } })} />
              {label}
            </label>
          ))}

          {cfg.drama_event_injector && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="每隔几个 tick 注入一次外部事件">
              事件频率
              <input type="number" min={1} defaultValue={cfg.drama_event_every_n ?? 3}
                disabled={isPlaying}
                onBlur={(e) => patchConfig({ config: { drama_event_every_n: Number(e.target.value) } })}
                style={{ ...selStyle, width: 48 }} />
            </label>
          )}
          {cfg.drama_tension && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="张力累积到该阈值即强制爆发">
              张力阈值
              <input type="number" min={0.1} step={0.1} defaultValue={cfg.drama_tension_threshold ?? 1.0}
                disabled={isPlaying}
                onBlur={(e) => patchConfig({ config: { drama_tension_threshold: Number(e.target.value) } })}
                style={{ ...selStyle, width: 48 }} />
            </label>
          )}
          {cfg.drama_director && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="每隔几个 tick 刷新一次导演调度">
              导演频率
              <input type="number" min={1} defaultValue={cfg.drama_director_every_n ?? 4}
                disabled={isPlaying}
                onBlur={(e) => patchConfig({ config: { drama_director_every_n: Number(e.target.value) } })}
                style={{ ...selStyle, width: 48 }} />
            </label>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {!sim ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
            还没有模拟。点击「＋ 新建模拟」创建一个，然后「▶ 自动演化」或「单步」让角色网络自行演化。
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
