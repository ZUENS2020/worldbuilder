import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import { downloadJson, pickJsonFile } from '../../utils/fileIo';

interface ProjectSwitcherProps {
  open: boolean;
  onClose: () => void;
  anchorRect?: DOMRect | null;
}

export default function ProjectSwitcher({ open, onClose, anchorRect }: ProjectSwitcherProps) {
  const { t, i18n } = useTranslation();
  const { project, projects, switchProject, deleteProject } = useAppStore();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const p = await api.createProject({ name: newName.trim(), description: '' });
      await useAppStore.getState().loadProjects();
      await switchProject(p.id);
      setNewName('');
      onClose();
    } catch (e) {
      console.error('Failed to create project:', e);
    }
    setCreating(false);
  };

  const handleSwitch = async (id: string) => {
    if (id === project?.id) return;
    await switchProject(id);
    onClose();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('projectSwitcher.deleteConfirm', { name }))) return;
    await deleteProject(id);
    // If no projects left, onClose will let App.tsx show the project selection page
    if (useAppStore.getState().projects.length === 0) {
      onClose();
    }
  };

  const handleDuplicate = async (id: string) => {
    setCreating(true);
    try {
      const copy = await api.duplicateProject(id);
      await useAppStore.getState().loadProjects();
      await switchProject(copy.id);
      onClose();
    } catch (e) {
      console.error('Failed to duplicate project:', e);
    }
    setCreating(false);
  };

  const handleExport = async (id: string, name: string) => {
    try {
      const bundle = await api.exportProject(id);
      downloadJson(name, bundle);
    } catch (e) {
      console.error('Failed to export project:', e);
      alert(t('projectSwitcher.exportFailed') + (e as Error).message);
    }
  };

  // Graph import is new-project only — it creates a fresh project, never merges.
  const handleImport = async () => {
    try {
      const bundle = await pickJsonFile();
      if (bundle == null) return;
      setCreating(true);
      const p = await api.importProject(bundle);
      await useAppStore.getState().loadProjects();
      await switchProject(p.id);
      onClose();
    } catch (e) {
      console.error('Failed to import project:', e);
      alert(t('projectSwitcher.importFailed') + (e as Error).message);
    }
    setCreating(false);
  };

  // Position the popup above the status bar anchor
  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 4,
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 320)),
        zIndex: 1100,
      }
    : {
        position: 'fixed',
        bottom: 36,
        left: 12,
        zIndex: 1100,
      };

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1099 }} onClick={onClose} />
      {/* Panel */}
      <div style={{
        ...style,
        width: 300,
        background: 'var(--mt-panel)',
        border: '1px solid var(--mt-border)',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: 'var(--mt-text)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid var(--mt-border)',
          fontWeight: 600, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{t('projectSwitcher.title')}</span>
          <span style={{ color: 'var(--mt-text-faint)', fontSize: 10 }}>{t('projectSwitcher.count', { count: projects.length })}</span>
        </div>

        {/* Project list */}
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {projects.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
              {t('projectSwitcher.empty')}
            </div>
          )}
          {projects.map((p) => {
            const isCurrent = p.id === project?.id;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
                  background: isCurrent ? 'var(--mt-accent-bg)' : 'transparent',
                  borderLeft: isCurrent ? '3px solid var(--mt-accent)' : '3px solid transparent',
                  cursor: isCurrent ? 'default' : 'pointer',
                  transition: 'background 0.1s',
                }}
                onClick={() => handleSwitch(p.id)}
                onMouseEnter={(e) => {
                  if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-window)';
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                <span style={{ fontSize: 14 }}>{isCurrent ? '📂' : '📁'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: isCurrent ? 600 : 400, fontSize: 12,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--mt-text-faint)' }}>
                    {p.updated_at ? new Date(p.updated_at).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'zh-CN') : ''}
                  </div>
                </div>
                <span
                  onClick={(e) => { e.stopPropagation(); handleExport(p.id, p.name); }}
                  style={{ fontSize: 11, color: '#ccc', cursor: 'pointer', padding: '2px 4px' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = 'var(--mt-accent)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#ccc'; }}
                  title={t('projectSwitcher.exportTip')}
                >
                  ⬇
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); handleDuplicate(p.id); }}
                  style={{ fontSize: 11, color: '#ccc', cursor: 'pointer', padding: '2px 4px' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = 'var(--mt-accent)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#ccc'; }}
                  title={t('projectSwitcher.duplicateTip')}
                >
                  ⧉
                </span>
                {isCurrent && (
                  <span style={{ fontSize: 10, color: 'var(--mt-accent)', fontWeight: 600 }}>{t('projectSwitcher.current')}</span>
                )}
                {!isCurrent && (
                  <span
                    onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                    style={{ fontSize: 10, color: '#ccc', cursor: 'pointer', padding: '2px 4px' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#c0392b'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = '#ccc'; }}
                    title={t('projectSwitcher.deleteTip')}
                  >
                    ✕
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* New project input */}
        <div style={{
          padding: '8px 12px', borderTop: '1px solid var(--mt-border)',
          display: 'flex', gap: 6,
        }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={t('projectSwitcher.newNamePlaceholder')}
            style={{
              flex: 1, background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
              borderRadius: 3, padding: '4px 8px', fontSize: 11, color: 'var(--mt-text)', outline: 'none',
            }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="mt-btn active"
            style={{ fontSize: 10, padding: '4px 10px', fontWeight: 600, border: '1px solid var(--mt-accent)', whiteSpace: 'nowrap' }}
          >
            {creating ? '...' : t('common.createConfirm')}
          </button>
        </div>

        {/* Graph import — always creates a new project */}
        <div style={{ padding: '0 12px 10px' }}>
          <button
            onClick={handleImport}
            disabled={creating}
            className="mt-btn"
            style={{ width: '100%', fontSize: 10, padding: '5px 0', border: '1px solid var(--mt-border)' }}
            title={t('projectSwitcher.importTip')}
          >
            {t('projectSwitcher.importBtn')}
          </button>
        </div>
      </div>
    </>
  );
}
