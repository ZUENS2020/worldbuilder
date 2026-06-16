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

export default function Toolbar() {
  const rf = useReactFlow();
  const {
    requestAutoLayout, layouting, setCreateOpen, tidyUp,
  } = useAppStore();

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

      <Group label="整理">
        <button
          className="mt-btn"
          onClick={tidyUp}
          disabled={layouting}
          title="一键整理：以人物为中心重新排列，同阵营聚拢，消除重叠"
          style={{ fontWeight: 600, fontSize: 12, padding: '4px 12px' }}
        >
          {layouting ? <span className="mt-spin">⏳</span> : '✨'} 整理
        </button>
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
