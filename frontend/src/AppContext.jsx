import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [photos, setPhotos] = useState([]);
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState(null);
  const [branchState, setBranchState] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [commits, setCommits] = useState([]);
  // Shared filter for Gallery and Cull — survives navigation between them
  // (and back-button navigation) since it lives at the AppProvider level.
  const [filter, setFilter] = useState('all');

  // Fetch initial data
  useEffect(() => {
    const init = async () => {
      try {
        const [photosRes, branchesRes] = await Promise.all([
          api.getPhotos(),
          api.getBranches()
        ]);
        setPhotos(photosRes.data);
        let branches = branchesRes.data;

        // Fresh-clone path: empty branches table → create 'main' so the
        // user can immediately make decisions without a manual setup step.
        if (branches.length === 0) {
          try {
            const created = await api.createBranch('main');
            branches = [created.data];
          } catch (e) {
            console.error('Failed to seed default branch', e);
          }
        }

        setBranches(branches);

        if (branches.length > 0) {
          // Prefer 'main' if it exists; otherwise the first branch.
          const mainBranch = branches.find((b) => b.name === 'main') || branches[0];
          await selectBranch(mainBranch.id);
        }
      } catch (error) {
        console.error("Failed to initialize app state", error);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const refreshCommits = async (branchId) => {
    const id = branchId ?? currentBranch;
    if (!id) return;
    try {
      const res = await api.listCommits(id);
      setCommits(res.data || []);
    } catch (e) {
      console.error('Failed to fetch commits', e);
    }
  };

  const deleteBranch = async (branchId) => {
    try {
      await api.deleteBranch(branchId);
    } catch (e) {
      // 400 (last branch / has forks) or 404 — surface to the caller so
      // the UI can show the message.
      const msg = e?.response?.data?.detail || e.message || 'Delete failed';
      console.error('Delete branch failed:', msg);
      throw new Error(msg);
    }
    // Refresh the branch list. If the deleted one was active, fall back to
    // 'main' (or the first remaining branch); otherwise keep the current.
    const branchesRes = await api.getBranches();
    setBranches(branchesRes.data);
    if (currentBranch === branchId) {
      const fallback =
        branchesRes.data.find((b) => b.name === 'main') || branchesRes.data[0];
      if (fallback) {
        await selectBranch(fallback.id);
      } else {
        setCurrentBranch(null);
        setBranchState({});
        setCommits([]);
      }
    }
  };

  const selectBranch = async (branchId) => {
    setCurrentBranch(branchId);
    try {
      const [stateRes, commitsRes] = await Promise.all([
        api.getBranchState(branchId),
        api.listCommits(branchId),
      ]);
      setBranchState(stateRes.data || {});
      setCommits(commitsRes.data || []);
    } catch (e) {
      console.error("Failed to fetch branch state", e);
    }
  };

  const commitCurrentRejects = async () => {
    if (!currentBranch) return null;
    try {
      const res = await api.commitRejects(currentBranch);
      // Refresh state + commits so the UI reflects the trash overlay and the
      // new entry in the commits list.
      const [stateRes, commitsRes] = await Promise.all([
        api.getBranchState(currentBranch),
        api.listCommits(currentBranch),
      ]);
      setBranchState(stateRes.data || {});
      setCommits(commitsRes.data || []);
      return res.data;
    } catch (e) {
      console.error('Commit rejects failed', e);
      return null;
    }
  };

  const revertCommit = async (commitId) => {
    if (!currentBranch) return;
    try {
      await api.revertCommit(commitId);
      const [stateRes, commitsRes] = await Promise.all([
        api.getBranchState(currentBranch),
        api.listCommits(currentBranch),
      ]);
      setBranchState(stateRes.data || {});
      setCommits(commitsRes.data || []);
    } catch (e) {
      console.error('Revert failed', e);
    }
  };

  const makeDecision = async (photoId, decision) => {
    if (!currentBranch) return;
    
    // Optimistic UI Update
    setBranchState(prev => ({ ...prev, [photoId]: decision }));
    
    // Auto-advance
    if (currentIndex < photos.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }

    // Async API Call
    try {
      await api.commitDecision(currentBranch, photoId, decision);
    } catch (e) {
      console.error("Commit failed", e);
      // Revert state if needed (simplified for MVP)
    }
  };

  const markBest = async (groupId, bestPhotoId) => {
    if (!currentBranch) return;

    const groupPhotos = photos.filter(p => p.group_id === groupId);
    const rejectIds = groupPhotos.map(p => p.id).filter(id => id !== bestPhotoId);

    // Optimistic update — 'best' is its own state value (rendered as a star).
    // Downloads/exports still treat it as kept on the server side.
    const newState = { ...branchState, [bestPhotoId]: 'best' };
    rejectIds.forEach(id => { newState[id] = 'reject'; });
    setBranchState(newState);

    // Jump to next group conceptually (here we just jump to first photo of next group)
    const nextGroupPhotoIndex = photos.findIndex((p, idx) => idx > currentIndex && p.group_id !== groupId);
    if (nextGroupPhotoIndex !== -1) {
      setCurrentIndex(nextGroupPhotoIndex);
    } else {
      setCurrentIndex(photos.length - 1);
    }

    try {
      await api.commitBest(currentBranch, groupId, bestPhotoId, rejectIds);
    } catch (e) {
      console.error("Best commit failed", e);
    }
  };

  const trashPhotos = async (ids) => {
    if (!currentBranch || !ids || ids.length === 0) return;
    setBranchState((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = 'trash';
      return next;
    });
    try {
      await api.commitTrash(currentBranch, ids);
    } catch (e) {
      console.error('Trash commit failed', e);
    }
  };

  const refreshPhotos = async () => {
    try {
      const res = await api.getPhotos();
      setPhotos(res.data);
    } catch (e) {
      console.error('Failed to refresh photos', e);
    }
  };

  const mergeIntoOneGroup = async (photoIds) => {
    if (!photoIds || photoIds.length < 2) return;
    try {
      await api.mergeGroups(photoIds);
      await refreshPhotos();
    } catch (e) {
      console.error('Merge failed', e);
    }
  };

  const permanentlyDeletePhotos = async (ids) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    // Optimistic: drop the photos and clear any branchState entries pointing
    // at them so the UI updates immediately.
    setPhotos((prev) => prev.filter((p) => !idSet.has(p.id)));
    setBranchState((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    try {
      await api.permanentlyDelete(ids);
    } catch (e) {
      console.error('Permanent delete failed', e);
      // On failure, resync from server so local state matches reality.
      await refreshPhotos();
    }
  };

  const restorePhotos = async (ids) => {
    if (!currentBranch || !ids || ids.length === 0) return;
    // Optimistic: remove the trash overlay locally. The underlying keep/reject
    // is held server-side, so refetch to get it back.
    setBranchState((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id] === 'trash') delete next[id];
      }
      return next;
    });
    try {
      await api.commitUntrash(currentBranch, ids);
      const stateRes = await api.getBranchState(currentBranch);
      setBranchState(stateRes.data || {});
    } catch (e) {
      console.error('Untrash commit failed', e);
    }
  };

  return (
    <AppContext.Provider value={{
      photos, branches, currentBranch, branchState, currentIndex, isLoading, commits,
      filter, setFilter,
      setCurrentIndex, selectBranch, deleteBranch, makeDecision, markBest, trashPhotos, restorePhotos,
      mergeIntoOneGroup, refreshPhotos, permanentlyDeletePhotos,
      commitCurrentRejects, revertCommit, refreshCommits,
      setPhotos, setBranches,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
