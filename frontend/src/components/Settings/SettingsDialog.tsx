import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { project } = useAppStore();
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project && open) {
      const s = project.settings || {};
      setEndpoint(s.ai_endpoint || '');
      setApiKey(s.ai_api_key ? '••••••••' : '');
      setModel(s.ai_model || '');
    }
  }, [project, open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const settings: any = { ...project.settings };
      if (endpoint) settings.ai_endpoint = endpoint;
      else delete settings.ai_endpoint;
      if (apiKey && apiKey !== '••••••••') settings.ai_api_key = apiKey;
      if (model) settings.ai_model = model;
      else delete settings.ai_model;
      await api.updateProject(project.id, { settings });
      onClose();
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    setSaving(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--mt-panel)', borderRadius: 8,
          border: '1px solid var(--mt-border)',
          width: 'min(480px, 88vw)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: 'var(--mt-text)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--mt-border)', fontWeight: 600, fontSize: 14 }}>
          ⚙️ 项目设置 · AI 配置
        </div>
        <div style={{ padding: '16px 18px' }}>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
              AI Endpoint（留空用默认 OpenRouter）
            </span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
              }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
              API Key（留空用环境变量）
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-v1-..."
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
              }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
              模型（留空用默认 deepseek/deepseek-v4-flash）
            </span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek/deepseek-v4-flash"
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
              }}
            />
          </label>
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--mt-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="mt-btn" onClick={onClose} style={{ border: '1px solid var(--mt-border)' }}>取消</button>
          <button className="mt-btn active" onClick={handleSave} disabled={saving}
            style={{ fontWeight: 600, border: '1px solid var(--mt-accent)' }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
