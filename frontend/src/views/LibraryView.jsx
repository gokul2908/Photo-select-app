import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { useAppContext } from '../AppContext';
import { HardDrive, RefreshCw, GitBranch, Play, Download, GitCommit, Undo2, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function formatTimestamp(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function LibraryView() {
  const {
    photos, branches, currentBranch, branchState, commits,
    selectBranch, setPhotos, commitCurrentRejects, revertCommit, deleteBranch,
  } = useAppContext();
  const keptCount = Object.values(branchState).filter((v) => v === 'keep' || v === 'best').length;
  const pendingRejectCount = useMemo(
    () => Object.values(branchState).filter((v) => v === 'reject').length,
    [branchState]
  );
  const [committing, setCommitting] = useState(false);
  const [revertingId, setRevertingId] = useState(null);
  const activeBranch = useMemo(
    () => branches.find((b) => b.id === currentBranch),
    [branches, currentBranch]
  );

  const handleCommitRejects = async () => {
    if (!currentBranch || pendingRejectCount === 0) return;
    setCommitting(true);
    try {
      await commitCurrentRejects();
    } finally {
      setCommitting(false);
    }
  };

  const handleRevert = async (commitId) => {
    setRevertingId(commitId);
    try {
      await revertCommit(commitId);
    } finally {
      setRevertingId(null);
    }
  };

  const handleDeleteBranch = async (e, branch) => {
    e.stopPropagation(); // don't trigger the branch-select onClick on the row
    const ok = window.confirm(
      `Delete branch "${branch.name}"?\n\n` +
        `All decisions and commits on this branch will be removed. Photos on ` +
        `disk are never touched. This cannot be undone.`
    );
    if (!ok) return;
    try {
      await deleteBranch(branch.id);
    } catch (err) {
      window.alert(err.message || 'Could not delete the branch.');
    }
  };
  const [importPath, setImportPath] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const navigate = useNavigate();

  const handleImport = async (e) => {
    e.preventDefault();
    if (!importPath) return;
    setIsImporting(true);
    try {
      await api.importDirectory(importPath);
      // Wait a bit and refresh catalog
      setTimeout(async () => {
        const res = await api.getPhotos();
        setPhotos(res.data);
        setIsImporting(false);
        setImportPath('');
      }, 3000);
    } catch (err) {
      console.error(err);
      setIsImporting(false);
    }
  };

  const handleBranchSelect = async (branchId) => {
    // Switch the active branch only — stay on the Library page so the user
    // can review counts and pick where to go next. Use the explicit
    // "Jump to Cull Engine" button or the header link to navigate.
    await selectBranch(branchId);
  };

  const handleCreateBranch = async () => {
    const name = prompt("New branch name:");
    if (!name) return;
    try {
      await api.createBranch(name, currentBranch);
      window.location.reload(); // naive reload to refresh branches for mvp
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="lib-scroll animate-fade-in">
      <div className="lib-column">

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><HardDrive size={24}/> Import Photos</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Paste an absolute path to a folder containing JPEGs to start a new indexing job.</p>
        
        <form onSubmit={handleImport} className="lib-import-form">
          <input 
            type="text" 
            className="input-field" 
            placeholder="/Users/name/Pictures/Event"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={isImporting}>
            {isImporting ? <RefreshCw className="lucide-spin" size={18} /> : 'Import'}
          </button>
        </form>
      </div>

      <div className="lib-two-col">
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><GitBranch size={24}/> Active Branches</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {branches.map(b => (
              <div
                key={b.id}
                onClick={() => handleBranchSelect(b.id)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--border-radius-sm)',
                  background: currentBranch === b.id ? 'var(--accent-primary-soft)' : 'var(--bg-secondary)',
                  cursor: 'pointer',
                  border: `1px solid ${currentBranch === b.id ? 'var(--accent-primary)' : 'var(--bg-glass-border)'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                }}
              >
                <span style={{ fontWeight: 500 }}>{b.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {currentBranch === b.id && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>Active</span>
                  )}
                  <button
                    onClick={(e) => handleDeleteBranch(e, b)}
                    disabled={branches.length <= 1}
                    aria-label={`Delete branch ${b.name}`}
                    title={branches.length <= 1 ? 'Cannot delete the last branch' : `Delete branch ${b.name}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: branches.length <= 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                      cursor: branches.length <= 1 ? 'not-allowed' : 'pointer',
                      padding: 4,
                      display: 'inline-flex',
                      borderRadius: 6,
                      opacity: branches.length <= 1 ? 0.4 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (branches.length > 1) e.currentTarget.style.color = 'var(--accent-reject)';
                    }}
                    onMouseLeave={(e) => {
                      if (branches.length > 1) e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button onClick={handleCreateBranch} className="btn" style={{ marginTop: '0.5rem' }}>
            + Create New Branch
          </button>
        </div>

        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Photos Indexed</h3>
          <div style={{ fontSize: '4rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.04em', lineHeight: 1 }}>
            {photos.length}
          </div>
          <button onClick={() => navigate('/cull')} className="btn btn-primary" style={{ marginTop: '1rem', width: '100%' }}>
            <Play size={18}/> Jump to Cull Engine
          </button>
          <button
            onClick={() => { if (currentBranch) window.location.href = api.downloadKeptUrl(currentBranch); }}
            disabled={!currentBranch || keptCount === 0}
            className="btn"
            style={{ width: '100%' }}
            title={keptCount === 0 ? 'Mark some photos as kept first' : 'Download kept photos as ZIP'}
          >
            <Download size={18}/> Download kept ({keptCount})
          </button>
        </div>
      </div>

      {/* Commits — reject→trash checkpoints with revert. Lives in the
          append-only commits ledger; this card is just a friendly surface. */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <GitCommit size={22} /> Commits
            {activeBranch && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.85rem', marginLeft: '0.4rem' }}>
                on {activeBranch.name}
              </span>
            )}
          </h2>
          <button
            onClick={handleCommitRejects}
            disabled={!currentBranch || pendingRejectCount === 0 || committing}
            className="btn btn-primary"
            style={{ padding: '0.45rem 0.95rem', fontSize: '0.85rem' }}
            title={
              !currentBranch ? 'Select a branch first'
                : pendingRejectCount === 0 ? 'No uncommitted rejects to move to trash'
                : `Move ${pendingRejectCount} rejected photo${pendingRejectCount === 1 ? '' : 's'} to trash`
            }
          >
            {committing ? <RefreshCw className="lucide-spin" size={16} /> : <GitCommit size={16} />}
            Commit current rejects ({pendingRejectCount})
          </button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
          Each commit moves the currently rejected photos to the Trash. Reverting a commit pulls them back to "rejected" — the originals on disk are never touched.
        </p>

        {commits.length === 0 ? (
          <div style={{
            border: '1px dashed var(--bg-glass-border)',
            borderRadius: 'var(--border-radius-sm)',
            padding: '1.5rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
          }}>
            No commits yet on this branch.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {commits.map((c, idx) => {
              const number = commits.length - idx; // newest is highest number
              const reverted = !c.is_active;
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.6rem 0.85rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--bg-glass-border)',
                    borderRadius: 'var(--border-radius-sm)',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: 6,
                      background: reverted ? 'var(--bg-elevated)' : 'var(--accent-primary-soft)',
                      color: reverted ? 'var(--text-muted)' : 'var(--accent-primary)',
                      flexShrink: 0,
                    }}>
                      <GitCommit size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>Commit #{number}</span>
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: reverted ? 'var(--bg-elevated)' : 'rgba(34, 197, 94, 0.15)',
                          color: reverted ? 'var(--text-muted)' : 'var(--accent-keep)',
                          border: `1px solid ${reverted ? 'var(--bg-glass-border)' : 'var(--accent-keep)'}`,
                        }}>
                          {reverted ? 'Reverted' : 'Active'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        {c.photo_count} photo{c.photo_count === 1 ? '' : 's'} · {formatTimestamp(c.timestamp)}
                      </div>
                    </div>
                  </div>
                  {c.is_active && (
                    <button
                      onClick={() => handleRevert(c.id)}
                      disabled={revertingId === c.id}
                      className="btn"
                      style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
                      title="Restore the photos in this commit to their previous reject state"
                    >
                      {revertingId === c.id ? <RefreshCw className="lucide-spin" size={14} /> : <Undo2 size={14} />}
                      Revert
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      </div>
    </div>
  );
}
