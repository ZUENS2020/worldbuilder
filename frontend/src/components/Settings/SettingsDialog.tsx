import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import {
  DEFAULT_GRAPH_HOPS,
  getGraphHops,
  type GraphHopSettings,
} from '../../types';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const HOP_FIELDS: { key: keyof GraphHopSettings; label: string; hint: string }[] = [
  { key: 'transform_expand', label: 'Transform 展开', hint: '展开关系人/事件等图谱 Transform 的 BFS 深度' },
  { key: 'transform_enemy', label: '敌对阵营搜索', hint: '「查找敌对阵营」Transform 的搜索深度' },
  { key: 'ai_context', label: 'AI 关系上下文', hint: 'AI 推断、矛盾检测、背景生成时纳入的关系范围' },
  { key: 'writing_context', label: '写作上下文', hint: '写作工作台生成时注入的图谱深度' },
  { key: 'isolate_subgraph', label: '子图隔离', hint: '探索模式「只看此子图」的 BFS 深度' },
];

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { project, setProject } = useAppStore();
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [graphHops, setGraphHops] = useState<GraphHopSettings>({ ...DEFAULT_GRAPH_HOPS });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project && open) {
      const s = project.settings || {};
      setEndpoint(s.ai_endpoint || '');
      setApiKey(s.ai_api_key ? '••••••••' : '');
      setModel(s.ai_model || '');
      setGraphHops(getGraphHops(project));
    }
  }, [project, open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const settings: any = { ...project.settings, graph_hops: graphHops };
      if (endpoint) settings.ai_endpoint = endpoint;
      else delete settings.ai_endpoint;
      if (apiKey && apiKey !== '••••••••') settings.ai_api_key = apiKey;
      if (model) settings.ai_model = model;
      else delete settings.ai_model;
      const updated = await api.updateProject(project.id, { settings });
      setProject(updated);
      onClose();
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    setSaving(false);
  };

  const setHop = (key: keyof GraphHopSettings, value: string) => {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return;
    setGraphHops((prev) => ({ ...prev, [key]: Math.max(1, Math.min(5, n)) }));
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
          width: 'min(520px, 92vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: 'var(--mt-text)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--mt-border)', fontWeight: 600, fontSize: 14 }}>
          ⚙️ 项目设置
        </div>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mt-text-muted)', marginBottom: 10, letterSpacing: '0.04em' }}>
            AI 配置
          </div>
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

          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--mt-text-muted)',
            margin: '18px 0 10px', letterSpacing: '0.04em',
            borderTop: '1px solid var(--mt-border-soft)', paddingTop: 14,
          }}>
            图谱跳数（1–5 跳 BFS）
          </div>
          {HOP_FIELDS.map(({ key, label, hint }) => (
            <label key={key} style={{ display: 'block', marginBottom: 10 }} title={hint}>
              <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
                {label}
              </span>
              <input
                type="number"
                min={1}
                max={5}
                value={graphHops[key]}
                onChange={(e) => setHop(key, e.target.value)}
                style={{
                  width: 72, padding: '6px 10px', fontSize: 12,
                  background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                  borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
                }}
              />
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--mt-text-muted)' }}>{hint}</span>
            </label>
          ))}
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
