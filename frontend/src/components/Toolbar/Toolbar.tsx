import { useReactFlow } from '@xyflow/react';
import { useAppStore } from '../../stores/appStore';
import type { LayoutType } from '../../utils/layout';

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 28 }}>{children}</div>
      <div style={{ fontSize: 9, color: 'var(--mt-text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function Toolbar() {
  // Safe: Toolbar is rendered inside <ReactFlowProvider>
  const rf = useReactFlow();
  const {
    layoutType, setLayoutType, requestAutoLayout, layouting, setCreateOpen,
  } = useAppStore();

  const layouts: { id: LayoutType; label: string; icon: string }[] = [
    { id: 'force', label: '力导向', icon: '🧲' },
    { id: 'radial', label: '放射', icon: '🎯' },
    { id: 'hierarchical', label: '层次', icon: '🗂️' },
  ];

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
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 10 }}>
        <span style={{ fontSize: 18 }}>🌐</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--mt-accent-dark)' }}>WorldBuilder</span>
      </div>
      <div className="mt-sep" />

      <Group label="实体">
        <button className="mt-btn" onClick={() => setCreateOpen(true)} title="新建实体 (Add Entity)">
          <span style={{ fontSize: 14 }}>➕</span> 新建实体
        </button>
      </Group>
      <div className="mt-sep" />

      <Group label="布局 Layout">
        {layouts.map((l) => (
          <button
            key={l.id}
            className={`mt-btn${layoutType === l.id ? ' active' : ''}`}
            onClick={() => setLayoutType(l.id)}
            title={l.label}
          >
            <span style={{ fontSize: 13 }}>{l.icon}</span> {l.label}
          </button>
        ))}
        <button className="mt-btn" onClick={requestAutoLayout} disabled={layouting} title="应用自动布局">
          {layouting ? <span className="mt-spin">⏳</span> : '▶'} 应用
        </button>
      </Group>
      <div className="mt-sep" />

      <Group label="视图 View">
        <button className="mt-btn" onClick={() => rf.zoomIn()} title="放大">🔍＋</button>
        <button className="mt-btn" onClick={() => rf.zoomOut()} title="缩小">🔍－</button>
        <button className="mt-btn" onClick={() => rf.fitView({ padding: 0.2 })} title="适应窗口">⤢ 适应</button>
      </Group>
    </div>
  );
}
