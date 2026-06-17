import { useEffect, useState, useCallback, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useAppStore } from './stores/appStore';
import { api } from './services/api';
import Toolbar from './components/Toolbar/Toolbar';
import Canvas from './components/Canvas/Canvas';
import Palette from './components/Palette/Palette';
import Inspector from './components/Inspector/Inspector';
import Timeline from './components/Timeline/Timeline';
import EventGraph from './components/EventGraph/EventGraph';
import AISuggestionReview from './components/AIReview/AISuggestionReview';
import SettingsDialog from './components/Settings/SettingsDialog';
import ProjectSwitcher from './components/ProjectSwitcher/ProjectSwitcher';

function App() {
  const {
    project, setProject, loadProjectData, loadProjects, switchProject, deleteProject,
    projects, entities, relations,
    aiCandidates, setAiCandidates, acceptCandidates,
    viewMode, setViewMode, setSettingsOpen,
  } = useAppStore();
  const [projectInput, setProjectInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const statusBarRef = useRef<HTMLSpanElement>(null);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = Number(localStorage.getItem('wb.inspectorWidth'));
    return saved >= 320 && saved <= 720 ? saved : 420;
  });

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = inspectorWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(720, Math.max(320, startW + (startX - ev.clientX)));
      setInspectorWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setInspectorWidth((w) => { localStorage.setItem('wb.inspectorWidth', String(w)); return w; });
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [inspectorWidth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const s = useAppStore.getState();
      if (s.settingsOpen) return;
      if (s.aiCandidates.length > 0) return;
      if (s.inspectorTab === 'transform') {
        e.preventDefault();
        s.setInspectorTab('details');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const projectList = await api.listProjects();
        useAppStore.setState({ projects: projectList });
        if (projectList.length > 0) {
          setProject(projectList[0]);
          await loadProjectData(projectList[0].id);
        }
      } catch (e) {
        console.error('Failed to load projects:', e);
      }
    })();
  }, []);

  const handleCreateProject = async () => {
    if (!projectInput.trim()) return;
    setCreating(true);
    try {
      const p = await api.createProject({ name: projectInput.trim(), description: '' });
      await loadProjects();
      await switchProject(p.id);
      setProjectInput('');
    } catch (e) {
      console.error('Failed to create project:', e);
    }
    setCreating(false);
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (!confirm(`确定删除项目「${name}」？所有实体与关系将被永久删除。`)) return;
    await deleteProject(id);
  };

  if (!project) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'var(--mt-window)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--mt-text)' }}>
        <div style={{ textAlign: 'center', background: 'var(--mt-panel)', border: '1px solid var(--mt-border)', borderRadius: 8, padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,0.12)', width: 'min(520px, 90vw)' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🌐</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--mt-accent-dark)' }}>WorldBuilder</h1>
          <p style={{ color: 'var(--mt-text-muted)', fontSize: 13, marginBottom: 22 }}>知识图谱驱动的世界观构建与调查</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, justifyContent: 'center' }}>
            <input
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              placeholder="输入项目名称..."
              autoFocus
              style={{ background: '#fff', border: '1px solid var(--mt-border)', borderRadius: 4, padding: '9px 12px', color: 'var(--mt-text)', fontSize: 14, outline: 'none', width: 240 }}
            />
            <button
              onClick={handleCreateProject}
              disabled={creating || !projectInput.trim()}
              className="mt-btn active"
              style={{ padding: '9px 18px', fontSize: 14, fontWeight: 600, border: '1px solid var(--mt-accent)' }}
            >
              创建项目
            </button>
          </div>
          {projects.length > 0 && (
            <div style={{ borderTop: '1px solid var(--mt-border)', paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--mt-text-muted)', marginBottom: 10, fontWeight: 600 }}>已有项目</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 4,
                      border: '1px solid var(--mt-border)',
                      background: 'var(--mt-window)',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>📁</span>
                    <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--mt-text-faint)' }}>
                        {p.description || '无描述'} · {p.updated_at ? new Date(p.updated_at).toLocaleDateString('zh-CN') : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => switchProject(p.id)}
                      className="mt-btn active"
                      style={{ fontSize: 11, padding: '4px 12px', fontWeight: 600, border: '1px solid var(--mt-accent)', whiteSpace: 'nowrap' }}
                    >
                      打开
                    </button>
                    <button
                      onClick={() => handleDeleteProject(p.id, p.name)}
                      className="mt-btn"
                      style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--mt-border)', color: '#c0392b' }}
                      title="删除项目"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const viewConfig: Record<string, { icon: string; label: string }> = {
    relations: { icon: '🕸️', label: '关系图' },
    events: { icon: '⚡', label: '事件图' },
  };
  const vc = viewConfig[viewMode] || viewConfig.relations;

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: 'var(--mt-window)', overflow: 'hidden' }}>
        <Toolbar />

        <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 4, gap: 4 }}>
          <Palette />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="mt-panel" style={{ flex: 1, minHeight: 0, padding: 0 }}>
              <div className="mt-panel-title" style={{ justifyContent: 'space-between' }}>
                <span>{vc.icon} {vc.label}</span>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  {(['relations', 'events'] as const).map((vm) => (
                    <button
                      key={vm}
                      className={`mt-btn${viewMode === vm ? ' active' : ''}`}
                      style={{ fontSize: 10, padding: '1px 8px', height: 18 }}
                      onClick={() => setViewMode(vm)}
                    >
                      {viewConfig[vm].icon} {viewConfig[vm].label}
                    </button>
                  ))}
                  <span style={{ width: 8 }} />
                  <button
                    className={`mt-btn${showTimeline ? ' active' : ''}`}
                    style={{ fontSize: 10, padding: '1px 8px', height: 18 }}
                    onClick={() => setShowTimeline((v) => !v)}
                  >
                    ⏳
                  </button>
                  <button
                    className="mt-btn"
                    style={{ fontSize: 10, padding: '1px 6px', height: 18 }}
                    onClick={() => setSettingsOpen(true)}
                  >
                    ⚙️
                  </button>
                </div>
              </div>
              <div className="mt-panel-body" style={{ overflow: 'hidden', position: 'relative' }}>
                {viewMode === 'relations' && <Canvas />}
                {viewMode === 'events' && <EventGraph />}
              </div>
            </div>
            {showTimeline && <Timeline />}
          </div>

          <div
            onMouseDown={startResize}
            title="拖拽调整宽度"
            style={{ width: 5, cursor: 'col-resize', flex: '0 0 5px', alignSelf: 'stretch', background: 'transparent' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-sel-border)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          />
          <div style={{ width: inspectorWidth, flex: `0 0 ${inspectorWidth}px`, display: 'flex', flexDirection: 'column' }}>
            <Inspector />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '3px 12px', borderTop: '1px solid var(--mt-border)', background: 'linear-gradient(var(--mt-panel-header-2), var(--mt-panel-header))', fontSize: 11, color: 'var(--mt-text-muted)' }}>
          <span
            ref={statusBarRef}
            onClick={() => setProjectSwitcherOpen((v) => !v)}
            style={{ cursor: 'pointer', borderRadius: 3, padding: '1px 6px', transition: 'background 0.1s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.background = 'var(--mt-accent-bg)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent'; }}
            title="点击切换项目"
          >
            📁 {project.name} ▾
          </span>
          <span>●&nbsp;{entities.length} 实体</span>
          <span>🔗 {relations.length} 关系</span>
          <span style={{ marginLeft: 'auto', color: 'var(--mt-text-faint)' }}>右键节点打开 Transform 面板 · 拖拽调色盘到画布创建实体</span>
        </div>
      </div>

      {aiCandidates.length > 0 && (
        <AISuggestionReview
          candidates={aiCandidates}
          onAccept={acceptCandidates}
          onDismiss={() => setAiCandidates([])}
        />
      )}
      <SettingsDialog
        open={useAppStore.getState().settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <ProjectSwitcher
        open={projectSwitcherOpen}
        onClose={() => setProjectSwitcherOpen(false)}
        anchorRect={statusBarRef.current?.getBoundingClientRect()}
      />
    </ReactFlowProvider>
  );
}

export default App;
