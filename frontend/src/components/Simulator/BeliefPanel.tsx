import { useEffect, useMemo, useState } from 'react';
import { useSimStore } from '../../stores/simStore';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';

interface BeliefRow {
  subject_id: string;
  subject_name: string;
  subject_type: string;
  believed_properties: Record<string, any>;
  truth_properties: Record<string, any>;
  as_of_tick: number;
}

type Diff = 'match' | 'stale' | 'unknown' | 'extra';

const DIFF_STYLE: Record<Diff, { color: string; label: string }> = {
  match: { color: 'var(--mt-text-muted)', label: '一致' },
  stale: { color: '#c0392b', label: '陈旧/错误' },
  unknown: { color: '#b8860b', label: '未知（迷雾）' },
  extra: { color: '#7d3c98', label: '已不存在' },
};

function fmt(v: any): string {
  if (v == null || v === '') return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Belief vs. truth for one observer: what this agent thinks the world is like
 * vs. canonical truth. Highlights stale/wrong beliefs and fog-of-war gaps. */
export default function BeliefPanel() {
  const sim = useSimStore((s) => s.sim);
  const projectId = useAppStore((s) => s.project?.id);
  const entities = useAppStore((s) => s.entities);

  const characters = useMemo(
    () => entities.filter((e) => e.type === 'character'),
    [entities],
  );

  const [observerId, setObserverId] = useState('');
  const [rows, setRows] = useState<BeliefRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Default the observer to the first character once entities load.
  useEffect(() => {
    if (!observerId && characters.length > 0) setObserverId(characters[0].id);
  }, [characters, observerId]);

  useEffect(() => {
    if (!projectId || !sim || !observerId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getBeliefs(projectId, sim.id, observerId)
      .then((data) => { if (!cancelled) setRows(data as BeliefRow[]); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Re-fetch when the world advances a tick.
  }, [projectId, sim?.id, observerId, sim?.current_tick]);

  const observerName = characters.find((c) => c.id === observerId)?.name || '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--mt-border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--mt-text-muted)' }}>以…的视角：</span>
        <select
          value={observerId}
          onChange={(e) => setObserverId(e.target.value)}
          style={{
            fontSize: 12, padding: '3px 6px', borderRadius: 4,
            border: '1px solid var(--mt-border)', background: '#fff', color: 'var(--mt-text)',
          }}
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: 'var(--mt-text-faint)', marginLeft: 'auto' }}>
          {loading ? '加载中…' : `${rows.length} 个认知对象`}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
        {rows.length === 0 && !loading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
            {sim
              ? `${observerName || '该角色'}还没有任何信念。单步推进后，TA 感知到的世界会在这里与真相对照。`
              : '先选择一个模拟。'}
          </div>
        )}
        {rows.map((r) => (
          <SubjectCard key={r.subject_id} row={r} self={r.subject_id === observerId} />
        ))}
      </div>
    </div>
  );
}

function SubjectCard({ row, self }: { row: BeliefRow; self: boolean }) {
  // Union of all keys across belief + truth, classified by diff.
  const keys = useMemo(() => {
    const set = new Set<string>([
      ...Object.keys(row.believed_properties || {}),
      ...Object.keys(row.truth_properties || {}),
    ]);
    return Array.from(set).sort();
  }, [row]);

  const classify = (k: string): Diff => {
    const hasB = k in (row.believed_properties || {});
    const hasT = k in (row.truth_properties || {});
    if (hasB && !hasT) return 'extra';
    if (!hasB && hasT) return 'unknown';
    return fmt(row.believed_properties[k]) === fmt(row.truth_properties[k]) ? 'match' : 'stale';
  };

  return (
    <div style={{
      border: '1px solid var(--mt-border)', borderRadius: 5,
      marginBottom: 8, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 9px', background: 'var(--mt-window)',
        borderBottom: '1px solid var(--mt-border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{row.subject_name}</span>
        {self && <span style={{ fontSize: 9, color: 'var(--mt-accent)', fontWeight: 600 }}>（自己）</span>}
        <span style={{ fontSize: 9, color: 'var(--mt-text-faint)', marginLeft: 'auto' }}>
          认知截至 t{row.as_of_tick}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: 'var(--mt-text-faint)' }}>
            <th style={cellHead}>属性</th>
            <th style={cellHead}>TA 以为</th>
            <th style={cellHead}>真相</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const d = classify(k);
            const st = DIFF_STYLE[d];
            return (
              <tr key={k} style={{ borderTop: '1px solid var(--mt-border)' }}>
                <td style={{ ...cell, color: 'var(--mt-text-muted)', whiteSpace: 'nowrap' }}>{k}</td>
                <td style={{ ...cell, color: st.color, fontWeight: d === 'stale' ? 600 : 400 }}>
                  {d === 'unknown' ? '—' : fmt(row.believed_properties[k])}
                </td>
                <td style={{ ...cell, color: d === 'match' ? 'var(--mt-text-muted)' : 'var(--mt-text)' }}>
                  {d === 'extra' ? '—' : fmt(row.truth_properties[k])}
                </td>
              </tr>
            );
          })}
          {keys.length === 0 && (
            <tr><td colSpan={3} style={{ ...cell, color: 'var(--mt-text-faint)' }}>（无可对照属性）</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const cellHead: React.CSSProperties = {
  textAlign: 'left', fontWeight: 500, fontSize: 10, padding: '3px 9px',
};
const cell: React.CSSProperties = {
  padding: '3px 9px', verticalAlign: 'top', wordBreak: 'break-word',
};
