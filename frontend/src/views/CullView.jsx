import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAppContext } from '../AppContext';
import { ArrowLeft, ChevronLeft, ChevronRight, Layers, PanelRightOpen, PanelRightClose, X } from 'lucide-react';
import { StatusIcon, STATUS_COLOR } from '../statusIcon';

// Distance a touch must travel to count as a swipe (rather than a tap).
const SWIPE_THRESHOLD_PX = 60;

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'keep', label: 'Kept' },
  { key: 'reject', label: 'Rejected' },
  { key: 'skip', label: 'Skipped' },
  { key: 'undecided', label: 'Undecided' },
];

function matchesFilter(filter, decision) {
  if (filter === 'all') return true;
  if (filter === 'undecided') return !decision;
  if (filter === 'keep') return decision === 'keep' || decision === 'best';
  return decision === filter;
}

// Reactive matchMedia so the rail layout switches between
// "pinned column" (desktop) and "slide-in drawer" (mobile) on viewport changes.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

function buildGroups(photos, isVisible) {
  // Map keyed by group_id — handles non-adjacent same-group photos that
  // result from a manual merge. `isVisible` filters out trashed photos
  // while still computing firstIndex against the full photos array so
  // clicking a group row jumps to the right index in setCurrentIndex.
  const map = new Map();
  photos.forEach((p, idx) => {
    if (!isVisible(p)) return;
    if (!map.has(p.group_id)) {
      map.set(p.group_id, { group_id: p.group_id, items: [], firstIndex: idx });
    }
    map.get(p.group_id).items.push(p);
  });
  return Array.from(map.values());
}

function summarizeGroup(group, branchState) {
  let keep = 0, best = 0, reject = 0, skip = 0;
  for (const p of group.items) {
    const s = branchState[p.id];
    if (s === 'keep') keep++;
    else if (s === 'best') best++;
    else if (s === 'reject') reject++;
    else if (s === 'skip') skip++;
  }
  return {
    keep, best, reject, skip,
    undecided: group.items.length - keep - best - reject - skip,
  };
}

function GroupRow({ group, isActive, summary, onClick }) {
  const burst = group.items.length > 1;
  const cover = group.items[0];
  const keptTotal = summary.keep + summary.best;

  // Only fetch the high-res preview after the row has been hovered at least
  // once; otherwise mounting the rail would queue up 1600px images for every
  // visible group at once.
  const [hasHovered, setHasHovered] = useState(false);

  let borderColor = 'transparent';
  if (isActive) borderColor = 'var(--accent-primary)';
  else if (keptTotal > 0 && summary.reject === 0 && summary.undecided === 0) borderColor = 'var(--accent-keep)';
  else if (summary.reject === group.items.length) borderColor = 'var(--accent-reject)';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHasHovered(true)}
      className="rail-group-row"
      style={{
        background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
        border: `1px solid ${borderColor === 'transparent' ? 'var(--bg-glass-border)' : borderColor}`,
      }}
    >
      <div className="rail-group-thumb">
        <img
          src={api.getThumbnailUrl(cover.id, 'strip')}
          alt=""
          loading="lazy"
          className="rail-thumb-img"
        />
        {hasHovered && (
          <img
            src={api.getThumbnailUrl(cover.id, 'main')}
            alt=""
            className="rail-thumb-img rail-thumb-hover"
          />
        )}
        {burst && (
          <div
            style={{
              position: 'absolute', top: 2, right: 2,
              background: 'rgba(0,0,0,0.78)', color: 'white',
              fontSize: '0.65rem', fontWeight: 700,
              padding: '2px 5px', borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 2,
            }}
          >
            <Layers size={10} />×{group.items.length}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Group {group.group_id}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.45rem', marginTop: 3, alignItems: 'center' }}>
          {summary.best > 0 && (
            <span style={{ color: STATUS_COLOR.best, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <StatusIcon status="best" size={11} /> {summary.best}
            </span>
          )}
          {summary.keep > 0 && (
            <span style={{ color: STATUS_COLOR.keep, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <StatusIcon status="keep" size={11} /> {summary.keep}
            </span>
          )}
          {summary.reject > 0 && (
            <span style={{ color: STATUS_COLOR.reject, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <StatusIcon status="reject" size={11} /> {summary.reject}
            </span>
          )}
          {summary.skip > 0 && (
            <span style={{ color: STATUS_COLOR.skip, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <StatusIcon status="skip" size={11} /> {summary.skip}
            </span>
          )}
          {summary.undecided > 0 && <span>· {summary.undecided}</span>}
        </div>
      </div>
    </div>
  );
}

export default function CullView() {
  const { photos, currentBranch, currentIndex, setCurrentIndex, branchState, makeDecision, markBest, filter, setFilter } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const railRef = useRef(null);
  const touchStartRef = useRef(null);
  const [touchDelta, setTouchDelta] = useState({ dx: 0, dy: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // Holds the just-decided photo for ~1s so the user sees a big confirmation
  // stamp on the photo they acted on before the view advances. `null` when
  // not confirming.
  const [confirmation, setConfirmation] = useState(null);
  const confirmationTimerRef = useRef(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  // Hidden by default on every viewport. The toggle button in the HUD opens
  // it; the X inside the rail (or the backdrop on mobile) closes it.
  const [isRailOpen, setIsRailOpen] = useState(false);

  // If the user arrives with a non-'all' filter active (e.g., tapped a tile
  // in the Gallery while filtering by Rejected), open the rail so the filter
  // is immediately visible and changeable. Mount-only — manually closing the
  // rail later doesn't get overridden.
  useEffect(() => {
    if (filter !== 'all') setIsRailOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trashed photos live in /trash, never the cull surfaces.
  const nonTrashed = useMemo(
    () => photos.filter((p) => branchState[p.id] !== 'trash'),
    [photos, branchState]
  );

  // Photos that match the current filter (e.g. only 'reject' photos when
  // the user has clicked the Rejected chip). This becomes the navigation
  // and rail population set; the filter chips show counts derived from it.
  const filteredPhotos = useMemo(
    () => nonTrashed.filter((p) => matchesFilter(filter, branchState[p.id])),
    [nonTrashed, branchState, filter]
  );
  const filteredIds = useMemo(() => new Set(filteredPhotos.map((p) => p.id)), [filteredPhotos]);

  // Counts shown on the filter chips (always against non-trashed photos).
  const filterCounts = useMemo(() => {
    const c = { all: nonTrashed.length, keep: 0, reject: 0, skip: 0, undecided: 0 };
    for (const p of nonTrashed) {
      const s = branchState[p.id];
      if (s === 'keep' || s === 'best') c.keep++;
      else if (s === 'reject') c.reject++;
      else if (s === 'skip') c.skip++;
      else if (!s) c.undecided++;
    }
    return c;
  }, [nonTrashed, branchState]);

  // visiblePhotos is the working set the rest of the view operates on.
  const visiblePhotos = filteredPhotos;

  // Resolve the active photo. If currentIndex points at a non-matching photo
  // (trashed, or filtered out), fall forward to the next matching one so the
  // main stage never has to load a photo that shouldn't be shown.
  const activePhoto = useMemo(() => {
    if (filteredPhotos.length === 0) return null;
    const raw = photos[currentIndex];
    if (raw && filteredIds.has(raw.id)) return raw;
    for (let i = currentIndex + 1; i < photos.length; i++) {
      if (filteredIds.has(photos[i].id)) return photos[i];
    }
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (filteredIds.has(photos[i].id)) return photos[i];
    }
    return null;
  }, [photos, currentIndex, filteredIds, filteredPhotos.length]);

  // Sync currentIndex back to the resolved activePhoto so the rest of
  // AppContext stays consistent (downloads, gallery navigation, etc.).
  useEffect(() => {
    if (!activePhoto) return;
    const idx = photos.findIndex((p) => p.id === activePhoto.id);
    if (idx >= 0 && idx !== currentIndex) setCurrentIndex(idx);
  }, [activePhoto, photos, currentIndex, setCurrentIndex]);

  // Back goes to the previous page in history when there is one. If the user
  // landed on /cull directly (deep link or refresh), location.key is 'default'
  // and there's nothing meaningful to go back to — fall back to the library.
  const goBack = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  }, [navigate, location.key]);

  // Step through visiblePhotos (skip trashed). Always store the full-array
  // index in AppContext so other views agree on the current selection.
  const stepBy = useCallback((delta) => {
    if (visiblePhotos.length === 0 || !activePhoto) return;
    const vi = visiblePhotos.findIndex((p) => p.id === activePhoto.id);
    const nextVi = Math.max(0, Math.min(visiblePhotos.length - 1, (vi < 0 ? 0 : vi) + delta));
    const target = visiblePhotos[nextVi];
    const fullIdx = photos.findIndex((p) => p.id === target.id);
    if (fullIdx >= 0) setCurrentIndex(fullIdx);
  }, [visiblePhotos, activePhoto, photos, setCurrentIndex]);

  const goPrev = useCallback(() => stepBy(-1), [stepBy]);
  const goNext = useCallback(() => stepBy(1), [stepBy]);

  // Single entry point for every decision. Locks the visible photo to the
  // one being decided on, stamps the big confirmation overlay for ~1s, then
  // releases the lock so the view shows the next photo. AppContext does its
  // optimistic state update + API call right away, so the underlying truth
  // and the displayed truth stay aligned the moment the lock releases.
  const triggerDecision = useCallback((kind) => {
    if (!activePhoto || confirmation) return;  // ignore re-triggers while confirming
    const photo = activePhoto;
    setConfirmation({ photoId: photo.id, decision: kind });
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
    confirmationTimerRef.current = setTimeout(() => {
      setConfirmation(null);
      confirmationTimerRef.current = null;
    }, 1000);
    if (kind === 'best') markBest(photo.group_id, photo.id);
    else makeDecision(photo.id, kind);
  }, [activePhoto, confirmation, makeDecision, markBest]);

  // Cleanup the confirmation timer if the user navigates away mid-stamp.
  useEffect(() => () => {
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
  }, []);

  // Swipe gestures on the main stage:
  //   right → keep, left → reject, up → mark best, down → skip.
  // Tracks live deltas so the photo follows the finger, then either snaps
  // back (under threshold) or flies off-screen and commits (past threshold).
  // Taps (zero / tiny movement) fall through so the Prev/Next buttons
  // underneath keep working.
  const handleTouchStart = useCallback((e) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    setIsDragging(true);
    setTouchDelta({ dx: 0, dy: 0 });
  }, []);

  const handleTouchMove = useCallback((e) => {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    if (!t) return;
    setTouchDelta({ dx: t.clientX - start.x, dy: t.clientY - start.y });
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    setIsDragging(false);
    // Snap back to center regardless — the big confirmation overlay (not the
    // swipe transform) is what carries the visual feedback now.
    setTouchDelta({ dx: 0, dy: 0 });
    if (!start || !activePhoto) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_THRESHOLD_PX) return;  // tap

    if (ax > ay) {
      triggerDecision(dx > 0 ? 'keep' : 'reject');
    } else {
      triggerDecision(dy < 0 ? 'best' : 'skip');
    }
  }, [activePhoto, triggerDecision]);

  const handleKeyDown = useCallback((e) => {
    if (!activePhoto) return;
    switch (e.key) {
      case 'ArrowRight': triggerDecision('keep'); break;
      case 'ArrowLeft':  triggerDecision('reject'); break;
      case 'ArrowDown':  triggerDecision('skip'); break;
      case 'ArrowUp':    triggerDecision('best'); break;
      case ',':
      case '[':
        goPrev(); break;
      case '.':
      case ']':
        goNext(); break;
      case 'Escape':
        goBack(); break;
      default: break;
    }
  }, [activePhoto, triggerDecision, goBack, goPrev, goNext]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const groups = useMemo(
    () => buildGroups(photos, (p) => filteredIds.has(p.id)),
    [photos, filteredIds]
  );

  // Auto-scroll the rail so the active group stays in view.
  useEffect(() => {
    if (!railRef.current) return;
    const activeEl = railRef.current.querySelector('[data-active="true"]');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }, [currentIndex, groups]);

  if (!photos || photos.length === 0) {
    return <div className="flex-center" style={{ height: '100%' }}>No photos available. Import first.</div>;
  }
  if (!activePhoto) {
    if (nonTrashed.length === 0) {
      return (
        <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: '0.5rem', color: 'var(--text-secondary)' }}>
          <div>All photos are in trash.</div>
          <div style={{ fontSize: '0.85rem' }}>Restore some from the Trash tab to keep culling.</div>
        </div>
      );
    }
    return (
      <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: '0.75rem', color: 'var(--text-secondary)' }}>
        <div>No photos match the "{filter}" filter.</div>
        <button onClick={() => setFilter('all')} className="btn btn-primary" style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}>
          Show all
        </button>
      </div>
    );
  }

  // While a confirmation stamp is showing, lock the displayed photo to the
  // one we just decided on — even though AppContext has already advanced
  // currentIndex behind the scenes — so the user sees the stamp on the
  // photo they actually acted on.
  const lockedPhoto = confirmation
    ? photos.find((p) => p.id === confirmation.photoId) || activePhoto
    : activePhoto;
  const displayedPhoto = lockedPhoto;

  const groupPhotos = filteredPhotos.filter((p) => p.group_id === displayedPhoto.group_id);
  const keeps = Object.values(branchState).filter((v) => v === 'keep' || v === 'best').length;
  const visibleIndex = visiblePhotos.findIndex((p) => p.id === displayedPhoto.id);

  // While the user is dragging, figure out what photo to show in the gutter
  // so it appears to slide in from the opposite side. Direction picks the
  // axis-appropriate "next" — markBest jumps to the next group's first
  // photo, the rest of the directions step to the next visible photo.
  let previewPhoto = null;
  let previewTransform = null;
  if (!confirmation && (Math.abs(touchDelta.dx) > 4 || Math.abs(touchDelta.dy) > 4)) {
    const ax = Math.abs(touchDelta.dx);
    const ay = Math.abs(touchDelta.dy);
    const horizontal = ax > ay;
    if (horizontal) {
      const next = visiblePhotos[visibleIndex + 1] || visiblePhotos[Math.max(0, visibleIndex - 1)] || null;
      previewPhoto = next && next.id !== displayedPhoto.id ? next : null;
      if (previewPhoto) {
        const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
        // dx > 0 → swipe right → preview slides in from the LEFT (fills the
        // void on the left as current photo moves right). Same logic mirrored
        // for left swipe.
        const tx = touchDelta.dx > 0 ? touchDelta.dx - w : touchDelta.dx + w;
        previewTransform = `translate(${tx}px, 0)`;
      }
    } else {
      // Vertical: up = best (jumps to first photo of next group), down = skip.
      if (touchDelta.dy < 0) {
        previewPhoto = photos.find(
          (p, i) =>
            i > photos.findIndex((x) => x.id === displayedPhoto.id) &&
            p.group_id !== displayedPhoto.group_id &&
            branchState[p.id] !== 'trash'
        ) || null;
      } else {
        previewPhoto = visiblePhotos[visibleIndex + 1] || null;
      }
      if (previewPhoto) {
        const h = typeof window !== 'undefined' ? window.innerHeight : 768;
        const ty = touchDelta.dy > 0 ? touchDelta.dy - h : touchDelta.dy + h;
        previewTransform = `translate(0, ${ty}px)`;
      }
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'row', background: '#000' }}>
      {/* Main column */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top HUD */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          display: 'flex', justifyContent: 'space-between',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)',
        }} className="cull-hud">
          <div className="cull-hud-left">
            <button onClick={goBack} className="btn" style={{ background: 'rgba(0,0,0,0.6)' }}>
              <ArrowLeft size={16} /> <span className="cull-hud-text">Back</span>
            </button>
          </div>
          <div className="cull-hud-right">
            <div className="cull-hud-counter">
              {visibleIndex + 1} <span style={{ color: 'var(--text-secondary)' }}>/ {visiblePhotos.length}</span>
            </div>
            <div className="cull-hud-keep">{keeps} <span className="cull-hud-text">Kept</span></div>
            <button
              onClick={() => setIsRailOpen((v) => !v)}
              className="btn"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              aria-label={isRailOpen ? 'Hide group list' : 'Show group list'}
            >
              {isRailOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
          </div>
        </div>

        {/* No-branch banner */}
        {!currentBranch && (
          <div style={{
            position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 11,
            background: 'rgba(245, 158, 11, 0.15)', border: '1px solid var(--accent-warning)',
            color: 'var(--accent-warning)', padding: '0.5rem 1rem', borderRadius: 'var(--border-radius-sm)',
            fontSize: '0.85rem',
          }}>
            No branch selected — decisions will not be saved. Go to Library and pick a branch.
          </div>
        )}

        {/* Stage */}
        <div
          className="cull-stage"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
        >
          <button
            onClick={goPrev}
            disabled={visibleIndex <= 0}
            aria-label="Previous photo"
            className="cull-nav-btn cull-nav-prev"
            style={{
              position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 5,
              background: 'rgba(0,0,0,0.55)', color: 'white', border: '1px solid var(--bg-glass-border)',
              borderRadius: '50%',
              cursor: visibleIndex <= 0 ? 'not-allowed' : 'pointer',
              opacity: visibleIndex <= 0 ? 0.35 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronLeft />
          </button>

          {/* Preview of the upcoming photo, sliding in from the gutter as
              the user drags. Sits behind the active photo via z-index. */}
          {previewPhoto && previewTransform && (
            <img
              src={api.getThumbnailUrl(previewPhoto.id, 'main')}
              alt=""
              aria-hidden="true"
              style={{
                position: 'absolute',
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                transform: previewTransform,
                transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                willChange: 'transform',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
          )}

          <img
            src={api.getThumbnailUrl(displayedPhoto.id, 'main')}
            alt="Main Cull"
            style={{
              position: 'relative',
              zIndex: 2,
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              // Live follow-the-finger transform. The slight tilt only
              // applies on horizontal motion when no preview is visible —
              // a tilting card alongside a carousel preview looks chaotic.
              transform: previewPhoto
                ? `translate(${touchDelta.dx}px, ${touchDelta.dy}px)`
                : `translate(${touchDelta.dx}px, ${touchDelta.dy}px) rotate(${touchDelta.dx * 0.04}deg)`,
              transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
              willChange: 'transform, opacity',
            }}
          />

          <button
            onClick={goNext}
            disabled={visibleIndex >= visiblePhotos.length - 1}
            aria-label="Next photo"
            className="cull-nav-btn cull-nav-next"
            style={{
              position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 5,
              background: 'rgba(0,0,0,0.55)', color: 'white', border: '1px solid var(--bg-glass-border)',
              borderRadius: '50%',
              cursor: visibleIndex >= visiblePhotos.length - 1 ? 'not-allowed' : 'pointer',
              opacity: visibleIndex >= visiblePhotos.length - 1 ? 0.35 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronRight />
          </button>

          {branchState[displayedPhoto.id] && (
            // Small status chip tucked just below the HUD so the photo subject
            // is never covered. Color + label make the state obvious at a glance.
            <div className="cull-status-chip" style={{
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
              color: STATUS_COLOR[branchState[displayedPhoto.id]] || 'var(--text-primary)',
              border: `1px solid ${STATUS_COLOR[branchState[displayedPhoto.id]] || 'transparent'}`,
            }}>
              <StatusIcon status={branchState[displayedPhoto.id]} size={16} />
              {branchState[displayedPhoto.id]}
            </div>
          )}

          {/* Decision stamp — appears for ~1s after a keep/reject/best/skip is
              triggered (by key, swipe, or click). Locks the displayed photo
              underneath via `displayedPhoto` so the stamp lands on the photo
              the user actually decided on, even though currentIndex has
              already advanced. */}
          {confirmation && (
            <div className="cull-decision-stamp" style={{
              color: STATUS_COLOR[confirmation.decision] || 'var(--text-primary)',
              borderColor: STATUS_COLOR[confirmation.decision] || 'var(--text-primary)',
            }}>
              <StatusIcon status={confirmation.decision} size={56} />
              <div className="cull-decision-stamp-label">
                {confirmation.decision === 'best' ? 'Marked best'
                  : confirmation.decision === 'keep' ? 'Kept'
                  : confirmation.decision === 'reject' ? 'Rejected'
                  : confirmation.decision === 'skip' ? 'Skipped'
                  : confirmation.decision}
              </div>
            </div>
          )}

          {/* Swipe-intent overlay — appears while dragging past a small
              threshold so the user sees the decision their swipe will commit. */}
          {(() => {
            const HINT = 40;
            const ax = Math.abs(touchDelta.dx);
            const ay = Math.abs(touchDelta.dy);
            if (Math.max(ax, ay) < HINT) return null;
            let label, color;
            if (ax > ay) {
              if (touchDelta.dx > 0) { label = 'Keep'; color = STATUS_COLOR.keep; }
              else { label = 'Reject'; color = STATUS_COLOR.reject; }
            } else {
              if (touchDelta.dy < 0) { label = 'Best'; color = STATUS_COLOR.best; }
              else { label = 'Skip'; color = STATUS_COLOR.skip; }
            }
            const opacity = Math.min(1, (Math.max(ax, ay) - HINT) / 80);
            return (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                padding: '0.6rem 1.4rem',
                borderRadius: 999,
                border: `2px solid ${color}`,
                color, background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(8px)',
                fontWeight: 700, fontSize: '1.4rem',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                opacity,
                pointerEvents: 'none',
                zIndex: 6,
              }}>
                {label}
              </div>
            );
          })()}
        </div>

        {/* Bottom strip — photos of the currently selected burst group on both
            desktop and mobile. The all-groups list lives in the right rail. */}
        <div className="cull-burst-strip">
          {groupPhotos.map((p) => (
            <div
              key={p.id}
              onClick={() => setCurrentIndex(photos.findIndex((x) => x.id === p.id))}
              className={`cull-burst-item${displayedPhoto.id === p.id ? ' is-active' : ''}`}
            >
              <img
                src={api.getThumbnailUrl(p.id, 'strip')}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {branchState[p.id] && (
                <div style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', borderRadius: '50%', padding: '4px', display: 'flex' }}>
                  <StatusIcon status={branchState[p.id]} size={14} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Keyboard legend — desktop only; phones don't have a keyboard. */}
        <div className="cull-keyboard-legend" style={{
          position: 'absolute', bottom: '180px', left: '50%', transform: 'translateX(-50%)',
          gap: '1rem', background: 'var(--bg-glass)', padding: '0.5rem 1rem',
          borderRadius: 'var(--border-radius-lg)', fontSize: '0.8rem', color: 'var(--text-secondary)',
        }}>
          <span><kbd>←</kbd> Reject</span>
          <span><kbd>→</kbd> Keep</span>
          <span><kbd>↑</kbd> Mark Best</span>
          <span><kbd>↓</kbd> Skip</span>
          <span><kbd>,</kbd> / <kbd>.</kbd> Prev / Next</span>
        </div>
      </div>

      {/* Mobile drawer backdrop — only when both mobile and open. */}
      {isMobile && isRailOpen && (
        <div
          onClick={() => setIsRailOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            zIndex: 19,
          }}
        />
      )}

      {/* Right rail — only mounted when open, on any viewport. On mobile it
          slides in as an overlay; on desktop it's a pinned 320px column. */}
      {isRailOpen && (
      <aside
        style={
          isMobile
            ? {
                position: 'absolute', top: 0, right: 0, bottom: 0,
                width: 'min(86vw, 320px)',
                background: 'var(--bg-secondary)',
                borderLeft: '1px solid var(--bg-glass-border)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 20,
                boxShadow: '-8px 0 30px rgba(0, 0, 0, 0.5)',
              }
            : {
                width: 320,
                flexShrink: 0,
                background: 'var(--bg-secondary)',
                borderLeft: '1px solid var(--bg-glass-border)',
                display: 'flex',
                flexDirection: 'column',
              }
        }
      >
        <div style={{
          padding: '0.7rem 0.85rem',
          borderBottom: '1px solid var(--bg-glass-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>All photos</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              <span>{groups.length} groups · {filteredPhotos.length}</span>
              <button
                onClick={() => setIsRailOpen(false)}
                aria-label="Close group list"
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: 4, display: 'inline-flex', borderRadius: 6,
                }}
              >
                <X size={18} />
              </button>
            </span>
          </div>
          {/* Filter chips — driven by filterCounts. Only photos matching the
              active chip appear in the rail list AND in the main-stage
              navigation; the rest of the view stays in sync via filteredIds. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
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
                    padding: '0.25rem 0.55rem',
                    fontSize: '0.72rem',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {f.label} <span style={{ opacity: 0.65, marginLeft: 3 }}>{filterCounts[f.key]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div
          ref={railRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {groups.map((group) => {
            const isActive = group.group_id === displayedPhoto.group_id;
            const summary = summarizeGroup(group, branchState);
            return (
              <div key={group.group_id} data-active={isActive ? 'true' : 'false'}>
                <GroupRow
                  group={group}
                  isActive={isActive}
                  summary={summary}
                  onClick={() => {
                    setCurrentIndex(group.firstIndex);
                    if (isMobile) setIsRailOpen(false);
                  }}
                />
              </div>
            );
          })}
        </div>
      </aside>
      )}
    </div>
  );
}
