import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

export const api = {
  // Library & Photos
  importDirectory: (path) => axios.post(`${API_BASE}/library/import`, { directory_path: path }),
  getImportStatus: () => axios.get(`${API_BASE}/library/status`),
  getPhotos: () => axios.get(`${API_BASE}/photos`),
  getThumbnailUrl: (id, size = 'main') => `${API_BASE}/photos/${id}/thumbnail/${size}`,
  getOriginalUrl: (id) => `${API_BASE}/photos/${id}/original`,

  // Branches & State
  getBranches: () => axios.get(`${API_BASE}/branches`),
  createBranch: (name, parentBranchId = null, parentCommitId = null) => 
    axios.post(`${API_BASE}/branches`, { 
      name, 
      parent_branch_id: parentBranchId, 
      parent_commit_id: parentCommitId 
    }),
  getBranchState: (branchId) => axios.get(`${API_BASE}/branches/${branchId}/state`),

  // Commits
  commitDecision: (branchId, photoId, decision) => 
    axios.post(`${API_BASE}/commits`, {
      branch_id: branchId,
      action_type: 'decide',
      payload: { photo_id: photoId, decision }
    }),
    
  commitBest: (branchId, groupId, bestPhotoId, autoRejectIds) =>
    axios.post(`${API_BASE}/commits`, {
      branch_id: branchId,
      action_type: 'best',
      payload: { group_id: groupId, best_photo_id: bestPhotoId, auto_reject: autoRejectIds }
    }),

  // Export
  exportPhotos: (branchId, destinationPath) =>
    axios.post(`${API_BASE}/export`, { branch_id: branchId, destination_path: destinationPath })
};
