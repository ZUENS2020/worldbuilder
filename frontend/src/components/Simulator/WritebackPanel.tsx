import { useCallback, useEffect, useState } from 'react';
import { useSimStore } from '../../stores/simStore';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';

interface WritebackItem {
  id: string;
  status: string;
  round_index: number;
  observer_name: string | null;
  partner_name: string | null;
  user_message: string;
  assistant_message: string;
  preview: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string | null;
}

export default function WritebackPanel() {
  const projectId = useAppStore((s) => s.project?.id);
  const { sim, writebackItems, writebackPreview, loadWritebackQueue, previewWriteback, applyWriteback, updateWritebackConfig } = useSimStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState<'mechanical' | 'llm_oracle'>('mechanical');
  const [busy, setBusy] = useState(false);

  const cfg = sim?.config || {};
  const trigger = cfg.writeback_trigger || 'manual';
  const everyN = cfg.writeback_every_n ?? 3;

  const refresh = useCallback(() => {
    if (projectId && sim?.id) loadWritebackQueue('pending');
  }, [projectId, sim?.id, loadWritebackQueue]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ids = [...selected];

  const onPreview = async () => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await previewWriteback(ids, depth);
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await applyWriteback(ids, depth);
      setSelected(new Set());
      await loadWritebackQueue('pending');
      if (projectId) await useAppStore.getState().loadProjectData(projectId);
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async (id: string) => {
    if (!projectId || !sim) return;
    await api.discardWriteback(projectId, sim.id, id);
    refresh();
  };

  const setTrigger = async (v: string) => {
    if (!sim) return;
    await updateWritebackConfig({ writeback_trigger: v });
  };

  const setEveryN = async (n: number) => {
    if (!sim) return;
    await updateWritebackConfig({ writeback_every_n: n });
  };

  const setCfgDepth = async (v: string) => {
    if (!sim) return;
    await updateWritebackConfig({ writeback_depth: v });
  };

  if (!sim) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--mt-text-muted)' }}>
        请先选择或新建一个模拟。
      </div>
    );
  }

  const items = (writebackItems || []) as WritebackItem[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: 12 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mt-border)', background: 'var(--mt-panel-header)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>回写触发</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label>
            <input type="radio" checked={trigger === 'manual'} onChange={() => setTrigger('manual')} /> 手动
          </label>
          <label>
            <input type="radio" checked={trigger === 'every_n_rounds'} onChange={() => setTrigger('every_n_rounds')} /> 每
            <input
              type="number" min={1} max={20} value={everyN}
              onChange={(e) => setEveryN(parseInt(e.target.value) || 3)}
              style={{ width: 40, margin: '0 4px' }}
              disabled={trigger !== 'every_n_rounds'}
            />
            轮
          </label>
          <label>
            <input type="radio" checked={trigger === 'auto_llm'} onChange={() => setTrigger('auto_llm')} /> 自动 LLM tick
          </label>
          {trigger !== 'auto_llm' && (
            <select value={cfg.writeback_depth || 'mechanical'} onChange={(e) => setCfgDepth(e.target.value)}>
              <option value="mechanical">机械（记忆+belief）</option>
              <option value="llm_oracle">LLM Oracle</option>
            </select>
          )}
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--mt-text-muted)', fontSize: 11 }}>
          ST 插件入队后在此审阅。详细预览与执行回写请在勾选条目后操作。
        </p>
      </div>

      <div style={{ padding: '8px 12px', display: 'flex', gap: 8, borderBottom: '1px solid var(--mt-border)' }}>
        <select value={depth} onChange={(e) => setDepth(e.target.value as 'mechanical' | 'llm_oracle')} style={{ fontSize: 11 }}>
          <option value="mechanical">预览/执行：机械</option>
          <option value="llm_oracle">预览/执行：LLM Oracle</option>
        </select>
        <button className="mt-btn" disabled={!ids.length || busy} onClick={onPreview}>预览影响</button>
        <button className="mt-btn active" disabled={!ids.length || busy} onClick={onApply}>执行回写</button>
      </div>

      {writebackPreview && (
        <pre style={{
          margin: 0, padding: 8, fontSize: 10, maxHeight: 120, overflow: 'auto',
          background: '#f8f4e8', borderBottom: '1px solid var(--mt-border)',
        }}>
          {JSON.stringify(writebackPreview, null, 2)}
        </pre>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {items.length === 0 ? (
          <div style={{ color: 'var(--mt-text-muted)', padding: 12 }}>暂无待回写条目（在 ST 中启用 writeback 并绑定本模拟）</div>
        ) : (
          items.map((row) => (
            <div
              key={row.id}
              style={{
                border: '1px solid var(--mt-border)', borderRadius: 6, marginBottom: 8,
                background: selected.has(row.id) ? 'rgba(99,140,255,0.08)' : '#fff',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer' }}
                onClick={() => toggleExpand(row.id)}
              >
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} onClick={(e) => e.stopPropagation()} />
                <span style={{ fontWeight: 600 }}>r{row.round_index}</span>
                <span>{row.observer_name || '?'}</span>
                {row.partner_name && <span>↔ {row.partner_name}</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--mt-text-muted)' }}>{row.status}</span>
              </div>
              {expanded.has(row.id) && (
                <div style={{ padding: '0 8px 8px', fontSize: 11 }}>
                  <div style={{ marginBottom: 4 }}><b>用户</b>：{row.user_message || '（空）'}</div>
                  <div style={{ marginBottom: 8 }}><b>角色</b>：{row.assistant_message || '（空）'}</div>
                  <button className="mt-btn" style={{ fontSize: 10 }} onClick={() => onDiscard(row.id)}>丢弃</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
