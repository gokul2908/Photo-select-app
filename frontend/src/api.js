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

  commitTrash: (branchId, photoIds) =>
    axios.post(`${API_BASE}/commits`, {
      branch_id: branchId,
      action_type: 'trash',
      payload: { photo_ids: photoIds },
    }),

  commitUntrash: (branchId, photoIds) =>
    axios.post(`${API_BASE}/commits`, {
      branch_id: branchId,
      action_type: 'untrash',
      payload: { photo_ids: photoIds },
    }),

  // User-facing commits: move current rejects to trash, list them, revert.
  commitRejects: (branchId) =>
    axios.post(`${API_BASE}/branches/${branchId}/commit-rejects`),
  listCommits: (branchId) =>
    axios.get(`${API_BASE}/branches/${branchId}/commits`),
  revertCommit: (commitId) =>
    axios.post(`${API_BASE}/commits/${commitId}/revert`),

  // Manual grouping — assigns every photo in `photoIds` the same group_id.
  mergeGroups: (photoIds) =>
    axios.post(`${API_BASE}/photos/regroup`, { photo_ids: photoIds }),

  // Permanent delete — removes the DB row + thumbnails. Original files preserved.
  permanentlyDelete: (photoIds) =>
    axios.post(`${API_BASE}/photos/delete`, { photo_ids: photoIds }),

  // Download / export
  downloadKeptUrl: (branchId) => `${API_BASE}/branches/${branchId}/download`,
  exportPhotos: (branchId, destinationPath) =>
    axios.post(`${API_BASE}/export`, { branch_id: branchId, destination_path: destinationPath })
};
