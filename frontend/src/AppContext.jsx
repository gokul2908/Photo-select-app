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

  // Fetch initial data
  useEffect(() => {
    const init = async () => {
      try {
        const [photosRes, branchesRes] = await Promise.all([
          api.getPhotos(),
          api.getBranches()
        ]);
        setPhotos(photosRes.data);
        setBranches(branchesRes.data);
        
        if (branchesRes.data.length > 0) {
          // Select first branch or 'main' by default
          const mainBranch = branchesRes.data.find(b => b.name === 'main') || branchesRes.data[0];
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

  const selectBranch = async (branchId) => {
    setCurrentBranch(branchId);
    try {
      const stateRes = await api.getBranchState(branchId);
      setBranchState(stateRes.data || {});
    } catch (e) {
      console.error("Failed to fetch branch state", e);
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

    // Optimistic update
    const newState = { ...branchState, [bestPhotoId]: 'keep' };
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

  return (
    <AppContext.Provider value={{
      photos, branches, currentBranch, branchState, currentIndex, isLoading,
      setCurrentIndex, selectBranch, makeDecision, markBest, setPhotos, setBranches
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
