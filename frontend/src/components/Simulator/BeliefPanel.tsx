import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSimStore } from '../../stores/simStore';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../services/api';

interface BeliefRelation {
  source_name?: string;
  target_name?: string;
  type?: string;
  type_label?: string;
  weight?: number;
  description?: string;
  label?: string;
}

interface BeliefRow {
  subject_id: string;
  subject_name: string;
  subject_type: string;
  believed_properties: Record<string, any>;
  truth_properties: Record<string, any>;
  believed_relations?: BeliefRelation[];
  truth_relations?: BeliefRelation[];
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

function relKey(r: BeliefRelation): string {
  return `${r.source_name}|${r.target_name}|${r.type}`;
}

export default function BeliefPanel() {
  const { t } = useTranslation();
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
  }, [projectId, sim?.id, observerId, sim?.current_tick]);

  const observerName = characters.find((c) => c.id === observerId)?.name || '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--mt-border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--mt-text-muted)' }}>{t('belief.perspective')}</span>
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
          {loading ? t('belief.loading') : t('belief.subjectCount', { count: rows.length })}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
        {rows.length === 0 && !loading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--mt-text-faint)', fontSize: 12 }}>
            {sim
              ? t('belief.emptyWithObserver', { name: observerName || t('belief.defaultObserver') })
              : t('belief.emptyNoSim')}
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
  const { t } = useTranslation();
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

  const relRows = useMemo(() => {
    const believed = row.believed_relations || [];
    const truth = row.truth_relations || [];
    const truthMap = new Map(truth.map((r) => [relKey(r), r]));
    const seen = new Set<string>();
    const out: { key: string; believed?: BeliefRelation; truth?: BeliefRelation; diff: Diff }[] = [];
    for (const b of believed) {
      const k = relKey(b);
      seen.add(k);
      const t = truthMap.get(k);
      const diff: Diff = !t ? 'extra' : (
        b.label === t.label || (
          b.type === t.type && Number(b.weight ?? 0).toFixed(2) === Number(t.weight ?? 0).toFixed(2)
        ) ? 'match' : 'stale'
      );
      out.push({ key: k, believed: b, truth: t, diff });
    }
    for (const t of truth) {
      const k = relKey(t);
      if (!seen.has(k)) out.push({ key: k, truth: t, diff: 'unknown' });
    }
    return out;
  }, [row]);

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
        {self && <span style={{ fontSize: 9, color: 'var(--mt-accent)', fontWeight: 600 }}>{t('belief.self')}</span>}
        <span style={{ fontSize: 9, color: 'var(--mt-text-faint)', marginLeft: 'auto' }}>
          {t('belief.cognitionAsOf', { tick: row.as_of_tick, count: relRows.length })}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: 'var(--mt-text-faint)' }}>
            <th style={cellHead}>{t('belief.colProperty')}</th>
            <th style={cellHead}>{t('belief.colBelieved')}</th>
            <th style={cellHead}>{t('belief.colTruth')}</th>
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
            <tr><td colSpan={3} style={{ ...cell, color: 'var(--mt-text-faint)' }}>{t('belief.noProps')}</td></tr>
          )}
        </tbody>
      </table>
      {relRows.length > 0 && (
        <div style={{ padding: '6px 9px', borderTop: '1px solid var(--mt-border)', background: '#fafafa' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--mt-text-muted)', marginBottom: 4 }}>{t('belief.relations')}</div>
          {relRows.map(({ key, believed, truth, diff }) => {
            const st = DIFF_STYLE[diff];
            return (
              <div key={key} style={{ fontSize: 10, marginBottom: 3, color: st.color }}>
                <span style={{ fontWeight: diff === 'stale' ? 600 : 400 }}>
                  {believed?.label || '—'}
                </span>
                {diff !== 'match' && truth?.label && (
                  <span style={{ color: 'var(--mt-text-muted)', marginLeft: 6 }}>
                    {t('belief.truthArrow', { label: truth.label })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const cellHead: React.CSSProperties = {
  textAlign: 'left', fontWeight: 500, fontSize: 10, padding: '3px 9px',
};
const cell: React.CSSProperties = {
  padding: '3px 9px', verticalAlign: 'top', lineHeight: 1.4,
};
