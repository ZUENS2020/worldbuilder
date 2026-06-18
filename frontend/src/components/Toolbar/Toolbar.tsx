import { useReactFlow } from '@xyflow/react';
import { useAppStore } from '../../stores/appStore';

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 28 }}>{children}</div>
      <div style={{ fontSize: 9, color: 'var(--mt-text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

const RELATION_LAYOUT_MODES = [
  ['radial', '径向', '同心圆：以主角色为中心分环排列'],
  ['force', '力导向', '力导向：相关节点自然成簇'],
] as const;

const EVENT_LAYOUT_MODES = [
  ['hierarchical', '层级', '左→右层级：按因果链分层排列'],
  ['force', '力导向', '力导向：相关事件自然成簇'],
] as const;

export default function Toolbar() {
  const rf = useReactFlow();
  const {
    viewMode,
    layouting, setCreateOpen, tidyUp,
    layoutMode, setLayoutMode,
    eventLayoutMode, setEventLayoutMode,
  } = useAppStore();

  const layoutActive = viewMode === 'relations' || viewMode === 'events';
  const tidyTitle = viewMode === 'events'
    ? '一键整理事件图：按当前布局模式重新排列因果链'
    : viewMode === 'relations'
      ? '一键整理关系图：按当前布局模式重新排列，消除重叠、减少连线交叉'
      : '模拟器视图无可整理的画布';

  const applyRelationLayoutMode = (mode: 'radial' | 'force') => {
    setLayoutMode(mode);
    if (viewMode === 'relations') tidyUp();
  };

  const applyEventLayoutMode = (mode: 'hierarchical' | 'force') => {
    setEventLayoutMode(mode);
    if (viewMode === 'events') tidyUp();
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        padding: '4px 8px',
        background: 'linear-gradient(var(--mt-panel-header-2), var(--mt-panel-header))',
        borderBottom: '1px solid var(--mt-border)',
      }}
    >
      {/* Brand → GitHub */}
      <a
        href="https://github.com/ZUENS2020/worldbuilder"
        target="_blank"
        rel="noopener noreferrer"
        title="在 GitHub 查看源码"
        style={{
          display: 'flex', alignItems: 'center', gap: 7, paddingRight: 10,
          textDecoration: 'none', cursor: 'pointer',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.7'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
      >
        <span style={{ fontSize: 18 }}>🌐</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--mt-accent-dark)' }}>WorldBuilder</span>
      </a>
      <div className="mt-sep" />

      <Group label="实体">
        <button className="mt-btn" onClick={() => setCreateOpen(true)} title="新建实体 (Add Entity)">
          <span style={{ fontSize: 14 }}>➕</span> 新建实体
        </button>
      </Group>
      <div className="mt-sep" />

      <Group label="整理">
        <button
          className="mt-btn"
          onClick={tidyUp}
          disabled={layouting || !layoutActive}
          title={tidyTitle}
          style={{ fontWeight: 600, fontSize: 12, padding: '4px 12px' }}
        >
          {layouting ? <span className="mt-spin">⏳</span> : '✨'} 整理
        </button>
        {viewMode === 'relations' && (
          <div style={{ display: 'flex', border: '1px solid var(--mt-border)', borderRadius: 4, overflow: 'hidden', marginLeft: 4 }}>
            {RELATION_LAYOUT_MODES.map(([mode, label, tip]) => (
              <button
                key={mode}
                onClick={() => applyRelationLayoutMode(mode)}
                disabled={layouting}
                title={tip}
                style={{
                  fontSize: 10, padding: '3px 8px', border: 'none', cursor: 'pointer',
                  background: layoutMode === mode ? 'var(--mt-accent)' : 'transparent',
                  color: layoutMode === mode ? '#fff' : 'var(--mt-text-muted)',
                  fontWeight: layoutMode === mode ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {viewMode === 'events' && (
          <div style={{ display: 'flex', border: '1px solid var(--mt-border)', borderRadius: 4, overflow: 'hidden', marginLeft: 4 }}>
            {EVENT_LAYOUT_MODES.map(([mode, label, tip]) => (
              <button
                key={mode}
                onClick={() => applyEventLayoutMode(mode)}
                disabled={layouting}
                title={tip}
                style={{
                  fontSize: 10, padding: '3px 8px', border: 'none', cursor: 'pointer',
                  background: eventLayoutMode === mode ? 'var(--mt-accent)' : 'transparent',
                  color: eventLayoutMode === mode ? '#fff' : 'var(--mt-text-muted)',
                  fontWeight: eventLayoutMode === mode ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </Group>
      <div className="mt-sep" />

      <Group label="视图 View">
        <button className="mt-btn" onClick={() => rf.zoomIn()} title="放大">🔍＋</button>
        <button className="mt-btn" onClick={() => rf.zoomOut()} title="缩小">🔍－</button>
        <button className="mt-btn" onClick={() => rf.fitView({ padding: 0.15 })} title="适应窗口">⤢ 适应</button>
      </Group>
    </div>
  );
}
