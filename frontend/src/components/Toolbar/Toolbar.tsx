import { useReactFlow } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
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
  ['radial', 'toolbar.layoutRadial', 'toolbar.layoutRadialTip'],
  ['force', 'toolbar.layoutForce', 'toolbar.layoutForceTip'],
] as const;

const EVENT_LAYOUT_MODES = [
  ['hierarchical', 'toolbar.layoutHierarchical', 'toolbar.layoutHierarchicalTip'],
  ['force', 'toolbar.layoutForce', 'toolbar.layoutForceEventTip'],
] as const;

export default function Toolbar() {
  const rf = useReactFlow();
  const { t } = useTranslation();
  const {
    viewMode,
    layouting, setCreateOpen, tidyUp,
    layoutMode, setLayoutMode,
    eventLayoutMode, setEventLayoutMode,
  } = useAppStore();

  const layoutActive = viewMode === 'relations' || viewMode === 'events';
  const tidyTitle = viewMode === 'events'
    ? t('toolbar.tidyEvents')
    : viewMode === 'relations'
      ? t('toolbar.tidyRelations')
      : t('toolbar.tidyDisabled');

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
        title={t('toolbar.viewSource')}
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

      <Group label={t('toolbar.groupEntity')}>
        <button className="mt-btn" onClick={() => setCreateOpen(true)} title={t('toolbar.addEntityTitle')}>
          <span style={{ fontSize: 14 }}>➕</span> {t('toolbar.addEntity')}
        </button>
      </Group>
      <div className="mt-sep" />

      <Group label={t('toolbar.groupTidy')}>
        <button
          className="mt-btn"
          onClick={tidyUp}
          disabled={layouting || !layoutActive}
          title={tidyTitle}
          style={{ fontWeight: 600, fontSize: 12, padding: '4px 12px' }}
        >
          {layouting ? <span className="mt-spin">⏳</span> : '✨'} {t('toolbar.tidy')}
        </button>
        {viewMode === 'relations' && (
          <div style={{ display: 'flex', border: '1px solid var(--mt-border)', borderRadius: 4, overflow: 'hidden', marginLeft: 4 }}>
            {RELATION_LAYOUT_MODES.map(([mode, label, tip]) => (
              <button
                key={mode}
                onClick={() => applyRelationLayoutMode(mode)}
                disabled={layouting}
                title={t(tip)}
                style={{
                  fontSize: 10, padding: '3px 8px', border: 'none', cursor: 'pointer',
                  background: layoutMode === mode ? 'var(--mt-accent)' : 'transparent',
                  color: layoutMode === mode ? '#fff' : 'var(--mt-text-muted)',
                  fontWeight: layoutMode === mode ? 600 : 400,
                }}
              >
                {t(label)}
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
                title={t(tip)}
                style={{
                  fontSize: 10, padding: '3px 8px', border: 'none', cursor: 'pointer',
                  background: eventLayoutMode === mode ? 'var(--mt-accent)' : 'transparent',
                  color: eventLayoutMode === mode ? '#fff' : 'var(--mt-text-muted)',
                  fontWeight: eventLayoutMode === mode ? 600 : 400,
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
        )}
      </Group>
      <div className="mt-sep" />

      <Group label={t('toolbar.groupView')}>
        <button className="mt-btn" onClick={() => rf.zoomIn()} title={t('toolbar.zoomIn')}>🔍＋</button>
        <button className="mt-btn" onClick={() => rf.zoomOut()} title={t('toolbar.zoomOut')}>🔍－</button>
        <button className="mt-btn" onClick={() => rf.fitView({ padding: 0.15 })} title={t('toolbar.fitTitle')}>⤢ {t('toolbar.fit')}</button>
      </Group>
    </div>
  );
}
