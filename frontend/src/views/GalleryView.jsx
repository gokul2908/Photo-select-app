import React, { useMemo, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppContext } from '../AppContext';
import { Image as ImageIcon, Layers, Trash2, Download, Square, CheckSquare, Combine } from 'lucide-react';
import { StatusIcon, STATUS_COLOR } from '../statusIcon';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'keep', label: 'Kept' },
  { key: 'reject', label: 'Rejected' },
  { key: 'skip', label: 'Skipped' },
  { key: 'undecided', label: 'Undecided' },
];

// Preserve scroll position across route changes (and accidental reloads —
// sessionStorage is per-tab and cleared on tab close). The grid is the
// scrollable element, not the window, so the value is its scrollTop.
const SCROLL_KEY = 'gallery_scroll_top';
const readSavedScroll = () => {
  const raw = sessionStorage.getItem(SCROLL_KEY);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const saveScroll = (value) => sessionStorage.setItem(SCROLL_KEY, String(value));

function buildGroups(photos, branchState) {
  // Map keyed by group_id — handles non-adjacent same-group photos that
  // result from a manual merge. Skip groups whose every member is trashed;
  // those belong to /trash.
  const map = new Map();
  photos.forEach((p, idx) => {
    if (!map.has(p.group_id)) {
      map.set(p.group_id, { group_id: p.group_id, items: [], firstIndex: idx });
    }
    map.get(p.group_id).items.push(p);
  });
  return Array.from(map.values()).filter((g) =>
    g.items.some((p) => branchState[p.id] !== 'trash')
  );
}

function summarize(group, branchState) {
  let keep = 0, best = 0, reject = 0, skip = 0, trash = 0;
  for (const p of group.items) {
    const s = branchState[p.id];
    if (s === 'keep') keep++;
    else if (s === 'best') best++;
    else if (s === 'reject') reject++;
    else if (s === 'skip') skip++;
    else if (s === 'trash') trash++;
  }
  return {
    keep, best, reject, skip, trash,
    undecided: group.items.length - keep - best - reject - skip - trash,
  };
}

function passesFilter(group, summary, filter) {
  if (filter === 'all') return true;
  if (filter === 'undecided') return summary.undecided > 0;
  // 'Kept' includes both keep and best — best is just a flagged keep.
  if (filter === 'keep') return summary.keep + summary.best > 0;
  return summary[filter] > 0;
}

function StatusDots({ summary }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: '0.72rem', fontWeight: 600 }}>
      {summary.best > 0 && (
        <span style={{ color: STATUS_COLOR.best, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <StatusIcon status="best" size={12} />{summary.best}
        </span>
      )}
      {summary.keep > 0 && (
        <span style={{ color: STATUS_COLOR.keep, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <StatusIcon status="keep" size={12} />{summary.keep}
        </span>
      )}
      {summary.reject > 0 && (
        <span style={{ color: STATUS_COLOR.reject, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <StatusIcon status="reject" size={12} />{summary.reject}
        </span>
      )}
      {summary.skip > 0 && (
        <span style={{ color: STATUS_COLOR.skip, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <StatusIcon status="skip" size={12} />{summary.skip}
        </span>
      )}
    </div>
  );
}

export default function GalleryView() {
  const { photos, branchState, setCurrentIndex, currentBranch, trashPhotos, mergeIntoOneGroup, filter, setFilter } = useAppContext();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(() => new Set());
  const gridRef = useRef(null);
  const restoredRef = useRef(false);

  // Restore scroll position once the grid has rendered with photos. Runs
  // after every render until restored — handles the case where photos are
  // still loading when the route mounts.
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    if (gridRef.current && photos.length > 0) {
      gridRef.current.scrollTop = readSavedScroll();
      restoredRef.current = true;
    }
  });

  const handleScroll = useCallback((e) => {
    saveScroll(e.currentTarget.scrollTop);
  }, []);

  const groups = useMemo(() => buildGroups(photos, branchState), [photos, branchState]);

  const counts = useMemo(() => {
    const c = { all: 0, keep: 0, reject: 0, skip: 0, undecided: 0 };
    for (const g of groups) {
      c.all += 1;
      const s = summarize(g, branchState);
      if (s.keep + s.best > 0) c.keep++;  // 'Kept' chip counts keep OR best
      if (s.reject > 0) c.reject++;
      if (s.skip > 0) c.skip++;
      if (s.undecided > 0) c.undecided++;
    }
    return c;
  }, [groups, branchState]);

  const visibleGroups = useMemo(
    () => groups.filter((g) => passesFilter(g, summarize(g, branchState), filter)),
    [groups, branchState, filter]
  );

  const toggleSelect = useCallback((groupId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(visibleGroups.map((g) => g.group_id)));
  }, [visibleGroups]);

  const openInCull = (firstIndex) => {
    setCurrentIndex(firstIndex);
    navigate('/cull');
  };

  const moveSelectedToTrash = async () => {
    const photoIds = [];
    for (const g of groups) {
      if (selected.has(g.group_id)) {
        for (const p of g.items) {
          if (branchState[p.id] !== 'trash') photoIds.push(p.id);
        }
      }
    }
    if (photoIds.length === 0) return;
    await trashPhotos(photoIds);
    clearSelection();
  };

  const mergeSelected = async () => {
    if (selected.size < 2) return;
    const photoIds = [];
    for (const g of groups) {
      if (selected.has(g.group_id)) {
        for (const p of g.items) photoIds.push(p.id);
      }
    }
    if (photoIds.length < 2) return;
    await mergeIntoOneGroup(photoIds);
    clearSelection();
  };

  const handleDownload = () => {
    if (!currentBranch) return;
    window.location.href = api.downloadKeptUrl(currentBranch);
  };

  if (!photos.length) {
    return (
      <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: '1rem', color: 'var(--text-secondary)' }}>
        <ImageIcon size={48} />
        <div>No photos indexed yet. Import a folder from the Library tab.</div>
      </div>
    );
  }

  const selectionCount = selected.size;
  const keptTotal = Object.values(branchState).filter((v) => v === 'keep' || v === 'best').length;

  return (
    <div className="page-shell animate-fade-in">
      {/* Filter bar */}
      <div className="glass-panel gallery-toolbar">
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="btn"
                style={{
                  background: active ? 'var(--text-primary)' : 'transparent',
                  color: active ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  borderColor: active ? 'var(--text-primary)' : 'var(--bg-glass-border)',
                  padding: '0.3rem 0.7rem',
                  fontSize: '0.8rem',
                  fontWeight: active ? 600 : 500,
                }}
              >
                {f.label} <span style={{ opacity: 0.65, marginLeft: 5 }}>{counts[f.key]}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {visibleGroups.length} groups · {photos.length} photos · {keptTotal} kept
          </div>
          <button
            onClick={handleDownload}
            disabled={!currentBranch || keptTotal === 0}
            className="btn"
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.85rem',
              background: 'var(--accent-keep)',
              borderColor: 'var(--accent-keep)',
              color: '#062c17',
              fontWeight: 600,
            }}
            title={keptTotal === 0 ? 'Mark some photos as kept first' : 'Download kept photos as ZIP'}
          >
            <Download size={16} /> Download kept
          </button>
        </div>
      </div>

      {/* Selection toolbar */}
      {selectionCount > 0 && (
        <div className="gallery-selection-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{selectionCount} selected</span>
            <button
              onClick={selectAllVisible}
              className="btn"
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', borderColor: 'transparent', color: 'var(--text-secondary)' }}
            >
              Select all visible
            </button>
            <button
              onClick={clearSelection}
              className="btn"
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', borderColor: 'transparent', color: 'var(--text-secondary)' }}
            >
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              onClick={mergeSelected}
              disabled={selectionCount < 2}
              className="btn"
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
              title={selectionCount < 2 ? 'Select 2 or more groups to merge' : 'Merge selected groups into one'}
            >
              <Combine size={16} /> Merge into one group
            </button>
            <button
              onClick={moveSelectedToTrash}
              className="btn"
              style={{
                background: 'var(--accent-reject)',
                color: 'white',
                borderColor: 'var(--accent-reject)',
                padding: '0.4rem 0.85rem',
                fontSize: '0.85rem',
              }}
            >
              <Trash2 size={16} /> Move to Trash
            </button>
          </div>
        </div>
      )}

      {/* Grid — critical: minHeight: 0 so flex item can actually shrink and scroll.
          Use gridAutoRows for a fixed row height instead of aspect-ratio on tiles:
          aspect-ratio gets clobbered by intrinsic image sizing in some engines, so
          rows would otherwise inherit the cover photo's natural height. */}
      <div ref={gridRef} onScroll={handleScroll} className="gallery-grid">
        {visibleGroups.map((group) => {
          const isSelected = selected.has(group.group_id);
          const summary = summarize(group, branchState);
          const burst = group.items.length > 1;
          const cover = group.items[0];

          const keptTotalForGroup = summary.keep + summary.best;
          let borderColor = 'transparent';
          if (isSelected) borderColor = 'var(--accent-primary)';
          else if (keptTotalForGroup > 0 && summary.reject === 0 && summary.undecided === 0) borderColor = 'var(--accent-keep)';
          else if (summary.reject === group.items.length) borderColor = 'var(--accent-reject)';

          return (
            <div
              key={group.group_id}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--border-radius-sm)',
                overflow: 'hidden',
                cursor: 'pointer',
                border: `2px solid ${borderColor}`,
                transition: 'transform 0.15s ease',
              }}
              onClick={() => openInCull(group.firstIndex)}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <img
                src={api.getThumbnailUrl(cover.id, 'strip')}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />

              {/* Checkbox — stopPropagation so it doesn't trigger tile click */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(group.group_id);
                }}
                aria-label={isSelected ? 'Deselect' : 'Select'}
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: 'none',
                  background: isSelected ? 'var(--accent-primary)' : 'rgba(0,0,0,0.55)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>

              {/* Burst badge */}
              {burst && (
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    background: 'rgba(0,0,0,0.78)',
                    color: 'white',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '3px 7px',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Layers size={11} />×{group.items.length}
                </div>
              )}

              {/* State strip at bottom */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: '0.4rem 0.55rem',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: 'white',
                  fontSize: '0.7rem',
                }}
              >
                <span style={{ opacity: 0.75 }}>Group {group.group_id}</span>
                <StatusDots summary={summary} />
              </div>
            </div>
          );
        })}
        {visibleGroups.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem' }}>
            No groups match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}
