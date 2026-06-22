import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';
import { SUPPORTED_LANGS } from '../../i18n';
import {
  DEFAULT_GRAPH_HOPS,
  getGraphHops,
  type GraphHopSettings,
} from '../../types';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const HOP_KEYS: (keyof GraphHopSettings)[] = [
  'transform_expand',
  'transform_enemy',
  'ai_context',
  'context_injection',
  'isolate_subgraph',
];

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const { project, setProject } = useAppStore();
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [graphHops, setGraphHops] = useState<GraphHopSettings>({ ...DEFAULT_GRAPH_HOPS });
  // 叙事语言：'' = 跟随界面，否则固定为某种语言（透传给后端推演引擎）
  const [narrativeLang, setNarrativeLang] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project && open) {
      const s = project.settings || {};
      setEndpoint(s.ai_endpoint || '');
      setApiKey(s.ai_api_key ? '••••••••' : '');
      setModel(s.ai_model || '');
      setNarrativeLang(s.narrative_language || '');
      setGraphHops(getGraphHops(project));
    }
  }, [project, open]);

  if (!open) return null;

  const changeUiLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

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
      if (narrativeLang) settings.narrative_language = narrativeLang;
      else delete settings.narrative_language;
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
          {t('settings.title')}
        </div>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mt-text-muted)', marginBottom: 10, letterSpacing: '0.04em' }}>
            {t('settings.interfaceSection')}
          </div>
          <label style={{ display: 'block', marginBottom: 12 }} title={t('settings.languageHint')}>
            <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
              {t('settings.language')}
            </span>
            <select
              value={SUPPORTED_LANGS.includes(i18n.language as any) ? i18n.language : 'zh'}
              onChange={(e) => changeUiLanguage(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
              }}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 12 }} title={t('settings.narrativeLanguageHint')}>
            <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
              {t('settings.narrativeLanguage')}
            </span>
            <select
              value={narrativeLang}
              onChange={(e) => setNarrativeLang(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                background: 'var(--mt-window)', border: '1px solid var(--mt-border)',
                borderRadius: 4, color: 'var(--mt-text)', outline: 'none',
              }}
            >
              <option value="">{t('settings.narrativeFollowUi')}</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>

          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--mt-text-muted)',
            margin: '18px 0 10px', letterSpacing: '0.04em',
            borderTop: '1px solid var(--mt-border-soft)', paddingTop: 14,
          }}>
            {t('settings.aiConfig')}
          </div>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
              {t('settings.aiEndpoint')}
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
              {t('settings.apiKey')}
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
              {t('settings.model')}
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
            {t('settings.graphHops')}
          </div>
          {HOP_KEYS.map((key) => {
            const hint = t(`settings.hops.${key}_hint`);
            return (
            <label key={key} style={{ display: 'block', marginBottom: 10 }} title={hint}>
              <span style={{ fontSize: 12, color: 'var(--mt-text-muted)', display: 'block', marginBottom: 4 }}>
                {t(`settings.hops.${key}`)}
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
            );
          })}
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--mt-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="mt-btn" onClick={onClose} style={{ border: '1px solid var(--mt-border)' }}>{t('common.cancel')}</button>
          <button className="mt-btn active" onClick={handleSave} disabled={saving}
            style={{ fontWeight: 600, border: '1px solid var(--mt-accent)' }}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
