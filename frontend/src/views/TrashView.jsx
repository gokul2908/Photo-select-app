import React, { useMemo, useState, useCallback } from 'react';
import { api } from '../api';
import { useAppContext } from '../AppContext';
import { Trash2, Undo2, Square, CheckSquare, Layers, AlertTriangle } from 'lucide-react';

export default function TrashView() {
  const { photos, branchState, currentBranch, restorePhotos, permanentlyDeletePhotos } = useAppContext();
  const [selected, setSelected] = useState(() => new Set());

  // Map keyed by group_id — handles non-adjacent same-group photos that
  // result from a manual merge.
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of photos) {
      if (branchState[p.id] !== 'trash') continue;
      if (!map.has(p.group_id)) map.set(p.group_id, { group_id: p.group_id, items: [] });
      map.get(p.group_id).items.push(p);
    }
    return Array.from(map.values());
  }, [photos, branchState]);

  const toggleSelect = useCallback((gid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(groups.map((g) => g.group_id))), [groups]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const photoIdsFromSelection = () => {
    const ids = [];
    for (const g of groups) {
      if (selected.has(g.group_id)) {
        for (const p of g.items) ids.push(p.id);
      }
    }
    return ids;
  };

  const restoreSelected = async () => {
    const ids = photoIdsFromSelection();
    if (ids.length === 0) return;
    await restorePhotos(ids);
    clearSelection();
  };

  const restoreAll = async () => {
    const ids = groups.flatMap((g) => g.items.map((p) => p.id));
    if (ids.length === 0) return;
    await restorePhotos(ids);
    clearSelection();
  };

  const permanentlyDeleteSelected = async () => {
    const ids = photoIdsFromSelection();
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Permanently remove ${ids.length} photo${ids.length === 1 ? '' : 's'} from the app?\n\n` +
        `Original files on disk are preserved — they remain in their folder, and ` +
        `you can re-import them later. Their commit history will be orphaned and the ` +
        `thumbnails will be deleted. This cannot be undone from within the app.`
    );
    if (!ok) return;
    await permanentlyDeletePhotos(ids);
    clearSelection();
  };

  if (!currentBranch) {
    return (
      <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: '1rem', color: 'var(--text-secondary)' }}>
        <Trash2 size={48} />
        <div>No branch selected. Pick a branch in the Library tab first.</div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: '1rem', color: 'var(--text-secondary)' }}>
        <Trash2 size={48} />
        <div>Trash is empty.</div>
        <div style={{ fontSize: '0.85rem' }}>Move photos to trash from the Gallery to see them here.</div>
      </div>
    );
  }

  const trashedCount = groups.reduce((n, g) => n + g.items.length, 0);
  const allSelected = selected.size === groups.length;
  const selectionCount = selected.size;
  const hasSelection = selectionCount > 0;

  return (
    <div className="page-shell animate-fade-in">
      {/* Header / selection bar */}
      <div className="glass-panel gallery-toolbar">
        <div>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Trash2 size={18} /> Trash
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {trashedCount} photo{trashedCount === 1 ? '' : 's'} in {groups.length} group{groups.length === 1 ? '' : 's'}
            {hasSelection ? ` · ${selectionCount} selected` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Selection controls — always available, mirroring Gallery */}
          {!allSelected && (
            <button onClick={selectAll} className="btn" style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}>
              Select all
            </button>
          )}
          {hasSelection && (
            <button
              onClick={clearSelection}
              className="btn"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderColor: 'transparent', color: 'var(--text-secondary)' }}
            >
              Clear
            </button>
          )}

          {/* Destructive: permanent delete (only when something is selected) */}
          {hasSelection && (
            <button
              onClick={permanentlyDeleteSelected}
              className="btn"
              style={{
                background: 'var(--accent-reject)',
                color: 'white',
                borderColor: 'var(--accent-reject)',
                padding: '0.4rem 0.85rem',
                fontSize: '0.85rem',
              }}
              title="Remove from the app permanently. Original files on disk are preserved."
            >
              <AlertTriangle size={16} /> Permanently delete
            </button>
          )}

          {/* Restore — different label when nothing is selected */}
          {hasSelection ? (
            <button onClick={restoreSelected} className="btn btn-primary" style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}>
              <Undo2 size={16} /> Restore selected
            </button>
          ) : (
            <button onClick={restoreAll} className="btn btn-primary" style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}>
              <Undo2 size={16} /> Restore all
            </button>
          )}
        </div>
      </div>

      <div className="gallery-grid">
        {groups.map((group) => {
          const isSelected = selected.has(group.group_id);
          const cover = group.items[0];
          const burst = group.items.length > 1;
          return (
            <div
              key={group.group_id}
              onClick={() => toggleSelect(group.group_id)}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--border-radius-sm)',
                overflow: 'hidden',
                cursor: 'pointer',
                border: isSelected ? '2px solid var(--accent-primary)' : '2px solid var(--accent-reject)',
                opacity: 0.85,
              }}
            >
              <img
                src={api.getThumbnailUrl(cover.id, 'strip')}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: 'grayscale(0.4)' }}
              />
              <div
                style={{
                  position: 'absolute', top: 6, left: 6,
                  width: 26, height: 26, borderRadius: 6,
                  background: isSelected ? 'var(--accent-primary)' : 'rgba(0,0,0,0.6)',
                  color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              </div>
              {burst && (
                <div
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'rgba(0,0,0,0.78)', color: 'white',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '3px 7px', borderRadius: 10,
                    display: 'flex', alignItems: 'center', gap: 3,
                  }}
                >
                  <Layers size={11} />×{group.items.length}
                </div>
              )}
              <div
                style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '0.4rem 0.55rem',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                  color: 'white', fontSize: '0.7rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <span style={{ opacity: 0.8 }}>Group {group.group_id}</span>
                <span style={{ color: 'var(--accent-reject)', fontWeight: 600 }}>Trashed</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
