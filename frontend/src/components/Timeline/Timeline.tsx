import { useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG } from '../../types';
import type { Entity } from '../../types';

export default function Timeline() {
  const { entities, relations, setSelectedEntity, selectedEntityIds } = useAppStore();

  // Get events sorted by time
  const events = useMemo(() => {
    const eventEntities = entities.filter((e) => e.type === 'event');
    return eventEntities.sort((a, b) => {
      const timeA = a.properties?.time || a.properties?.date || '';
      const timeB = b.properties?.time || b.properties?.date || '';
      return timeA.localeCompare(timeB);
    });
  }, [entities]);

  // Get event participants: both directions (source→event and event→source)
  // and multiple relation types that imply participation
  const PARTICIPANT_TYPES = ['participated', 'caused', 'member_of'];
  const getParticipants = (eventId: string) => {
    const seen = new Set<string>();
    return relations
      .filter((r) => {
        if (r.target_id !== eventId && r.source_id !== eventId) return false;
        return PARTICIPANT_TYPES.includes(r.type);
      })
      .map((r) => {
        // If relation points TO event, participant is source; otherwise target
        const participantId = r.target_id === eventId ? r.source_id : r.target_id;
        const entity = entities.find((e) => e.id === participantId);
        if (!entity) return null;
        // A hub entity can link to the same event via several participation
        // relations; show it once so React keys stay unique.
        if (seen.has(entity.id)) return null;
        seen.add(entity.id);
        const role = r.properties?.result || r.properties?.role || r.properties?.description || '';
        return { ...entity, role };
      })
      .filter(Boolean) as (Entity & { role: string })[];
  };

  const timedEntities = useMemo(() => {
    const sortKey = (e: Entity) => {
      const simMeta = e.properties?._sim as { tick?: number } | undefined;
      if (simMeta?.tick != null) {
        return `${String(simMeta.tick).padStart(6, '0')}-2`;
      }
      const time = e.properties?.time || e.properties?.date || e.properties?.year || '';
      return `000000-0-${time}`;
    };
    return entities
      .filter((e) => e.properties?.time || e.properties?.date || e.properties?.year || e.properties?._sim)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [entities]);

  return (
    <div className="mt-panel" style={{
      height: 168,
      borderLeft: 'none',
      borderRight: 'none',
      borderBottom: 'none',
    }}>
      {/* Timeline header */}
      <div className="mt-panel-title">
        ⏳ 时间轴 · Timeline
        <span style={{ color: 'var(--mt-text-muted)', fontSize: 10, fontWeight: 400, marginLeft: 8 }}>
          {events.length} 事件 · {timedEntities.length} 时间节点
        </span>
      </div>

      {/* Timeline content */}
      <div className="mt-panel-body" style={{ padding: '10px 16px', display: 'flex', gap: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        {timedEntities.length === 0 ? (
          <div style={{ color: 'var(--mt-text-muted)', fontSize: 11, padding: '8px 0' }}>
            暂无时间节点。为事件实体添加 "time" 属性即可显示在时间轴上。
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            {timedEntities.map((entity, i) => {
              const config = ENTITY_CONFIG[entity.type] || ENTITY_CONFIG.event;
              const time = entity.properties?.time || entity.properties?.date || entity.properties?.year || '?';
              const status = entity.properties?.status as string | undefined;
              const simTick = (entity.properties?._sim as { tick?: number } | undefined)?.tick;
              const participants = entity.type === 'event' ? getParticipants(entity.id) : [];
              const isSelected = selectedEntityIds.includes(entity.id);

              return (
                <div key={entity.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 120 }}>
                  {/* Timeline dot */}
                  <div
                    onClick={() => setSelectedEntity(entity.id)}
                    style={{
                      width: isSelected ? 14 : 10,
                      height: isSelected ? 14 : 10,
                      borderRadius: '50%',
                      background: isSelected ? config.color : `${config.color}60`,
                      border: isSelected ? `2px solid ${config.color}` : '1px solid var(--mt-border)',
                      cursor: 'pointer',
                      marginBottom: 4,
                      transition: 'all 0.2s',
                    }}
                  />

                  {/* Connector line */}
                  {i < timedEntities.length - 1 && (
                    <div style={{
                      width: 80,
                      height: 1,
                      background: 'var(--mt-border)',
                      position: 'absolute',
                      top: 5,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      zIndex: -1,
                    }} />
                  )}

                  {/* Time label */}
                  <div style={{
                    fontSize: 9,
                    color: config.color,
                    marginBottom: 2,
                    fontWeight: 600,
                  }}>
                    {time}
                    {simTick != null && <span style={{ color: 'var(--mt-text-faint)' }}> · t{simTick}</span>}
                  </div>
                  {status === 'pending' && (
                    <div style={{ fontSize: 8, color: '#5a4ba8', marginBottom: 2 }}>🕓 悬决</div>
                  )}
                  {status === 'resolved' && (
                    <div style={{ fontSize: 8, color: '#1f7a4d', marginBottom: 2 }}>✅ 已结算</div>
                  )}

                  {/* Entity name */}
                  <div
                    onClick={() => setSelectedEntity(entity.id)}
                    style={{
                      fontSize: 10,
                      color: isSelected ? '#fff' : 'var(--mt-text)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      maxWidth: 100,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      background: isSelected ? config.color : 'transparent',
                      padding: '2px 6px',
                      borderRadius: 3,
                      border: `1px solid ${isSelected ? config.color : 'transparent'}`,
                    }}
                  >
                    {config.icon} {entity.name}
                  </div>

                  {/* Participants */}
                  {participants.length > 0 && (
                    <div style={{ marginTop: 2, textAlign: 'center' }}>
                      {participants.map((p) => {
                        const pCfg = ENTITY_CONFIG[p.type] || ENTITY_CONFIG.character;
                        return (
                          <div key={p.id} style={{ fontSize: 8, color: 'var(--mt-text-muted)' }}>
                            {pCfg.icon} {p.name}
                            {p.role && <span style={{ color: 'var(--mt-text-faint)' }}> ({p.role.length > 12 ? p.role.slice(0, 12) + '…' : p.role})</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
