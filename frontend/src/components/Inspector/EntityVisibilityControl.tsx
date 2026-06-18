import { useState } from 'react';
import { ENTITY_CONFIG } from '../../types';
import type { EntityType } from '../../types';
import { VISIBILITY_KEY } from '../../utils/propertyOrder';

type VisMeta = {
  mode: 'public' | 'groups' | 'predicate';
  groups?: string[];
  predicate?: { key: string; op: string; value: string };
};

type EntityLike = { id: string; name: string; type: string; properties?: Record<string, unknown> };
type TagLike = { id: string; name: string; entityIds: string[] };

type Props = {
  entity: EntityLike;
  entities: EntityLike[];
  tags: TagLike[];
  updateEntity: (id: string, data: { properties: Record<string, unknown> }) => void;
  sectionLabel: React.CSSProperties;
  fieldStyle: React.CSSProperties;
};

const OPS = ['eq', 'ne', 'contains', 'gt', 'lt', 'gte', 'lte', 'exists'];

export default function EntityVisibilityControl({
  entity, entities, tags, updateEntity, sectionLabel, fieldStyle,
}: Props) {
  const [open, setOpen] = useState(false);
  const meta = ((entity.properties || {})[VISIBILITY_KEY] as VisMeta) || { mode: 'public' };
  const factions = entities.filter((e) => e.type === 'faction');

  const setMeta = (next: VisMeta | null) => {
    const props = { ...(entity.properties || {}) };
    if (!next || next.mode === 'public') delete props[VISIBILITY_KEY];
    else props[VISIBILITY_KEY] = next;
    updateEntity(entity.id, { properties: props });
  };

  const toggleGroup = (id: string) => {
    const cur = meta.groups ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setMeta({ mode: 'groups', groups: next });
  };

  const summary = meta.mode === 'public'
    ? '🌐 公开（所有人可见）'
    : meta.mode === 'groups'
      ? `👥 群体（${(meta.groups ?? []).length} 个）`
      : '🧩 条件';

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mt-border-soft)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={sectionLabel}>👁 实体可见度</span>
        <button
          className="mt-btn"
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--mt-border)' }}
        >
          {open ? '▲ 收起' : '设置'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: meta.mode === 'public' ? 'var(--mt-text-faint)' : 'var(--mt-accent)', marginTop: 3 }}>
        {summary}
      </div>

      {open && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['public', 'groups', 'predicate'] as const).map((m) => {
              const active = meta.mode === m;
              return (
                <button
                  key={m}
                  className={`mt-btn${active ? ' active' : ''}`}
                  style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${active ? 'var(--mt-accent)' : 'var(--mt-border)'}` }}
                  onClick={() => setMeta(m === 'public' ? { mode: 'public' }
                    : m === 'groups' ? { mode: 'groups', groups: meta.groups ?? [] }
                    : { mode: 'predicate', predicate: meta.predicate ?? { key: '', op: 'eq', value: '' } })}
                >
                  {m === 'public' ? '🌐 公开' : m === 'groups' ? '👥 群体' : '🧩 条件'}
                </button>
              );
            })}
          </div>

          {meta.mode === 'groups' && (
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--mt-border-soft)', borderRadius: 3, background: '#fff', padding: 5 }}>
              {factions.length > 0 && (
                <div style={{ fontSize: 9, color: 'var(--mt-text-faint)', margin: '0 0 2px' }}>阵营</div>
              )}
              {factions.map((f) => {
                const checked = (meta.groups ?? []).includes(f.id);
                const cfg = ENTITY_CONFIG[f.type as EntityType];
                return (
                  <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '1px 2px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleGroup(f.id)} />
                    <span>{cfg?.icon} {f.name}</span>
                  </label>
                );
              })}
              {tags.length > 0 && (
                <div style={{ fontSize: 9, color: 'var(--mt-text-faint)', margin: '4px 0 2px' }}>标签</div>
              )}
              {tags.map((t) => {
                const checked = (meta.groups ?? []).includes(t.id);
                return (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '1px 2px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleGroup(t.id)} />
                    <span>🏷 {t.name}</span>
                  </label>
                );
              })}
              {factions.length === 0 && tags.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--mt-text-faint)' }}>（无阵营或标签可选）</div>
              )}
            </div>
          )}

          {meta.mode === 'predicate' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 9, color: 'var(--mt-text-faint)' }}>
                观察者满足条件才能看到此实体
              </div>
              <input
                placeholder="属性名（如 rank）"
                value={meta.predicate?.key ?? ''}
                onChange={(e) => setMeta({ mode: 'predicate', predicate: { ...(meta.predicate ?? { key: '', op: 'eq', value: '' }), key: e.target.value } })}
                style={{ ...fieldStyle, padding: '3px 6px', fontSize: 11 }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  value={meta.predicate?.op ?? 'eq'}
                  onChange={(e) => setMeta({ mode: 'predicate', predicate: { ...(meta.predicate ?? { key: '', op: 'eq', value: '' }), op: e.target.value } })}
                  style={{ ...fieldStyle, padding: '3px 4px', fontSize: 11, flex: '0 0 84px' }}
                >
                  {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <input
                  placeholder="值"
                  value={meta.predicate?.value ?? ''}
                  onChange={(e) => setMeta({ mode: 'predicate', predicate: { ...(meta.predicate ?? { key: '', op: 'eq', value: '' }), value: e.target.value } })}
                  style={{ ...fieldStyle, padding: '3px 6px', fontSize: 11, flex: 1 }}
                  disabled={meta.predicate?.op === 'exists'}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
