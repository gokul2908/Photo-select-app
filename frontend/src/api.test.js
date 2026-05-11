import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: null })),
    post: vi.fn(() => Promise.resolve({ data: null })),
  },
}));

import axios from 'axios';
import { api } from './api';

beforeEach(() => {
  axios.get.mockClear();
  axios.post.mockClear();
});

describe('thumbnail and original URL builders', () => {
  it('builds the main-size thumbnail URL by default', () => {
    expect(api.getThumbnailUrl(7)).toBe('http://localhost:8000/api/photos/7/thumbnail/main');
  });

  it('builds the strip-size thumbnail URL when requested', () => {
    expect(api.getThumbnailUrl(7, 'strip')).toBe('http://localhost:8000/api/photos/7/thumbnail/strip');
  });

  it('builds the original URL', () => {
    expect(api.getOriginalUrl(42)).toBe('http://localhost:8000/api/photos/42/original');
  });
});

describe('commit payloads', () => {
  it('commitDecision sends action_type=decide with photo_id+decision', async () => {
    await api.commitDecision(3, 42, 'keep');

    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/commits',
      {
        branch_id: 3,
        action_type: 'decide',
        payload: { photo_id: 42, decision: 'keep' },
      }
    );
  });

  it('commitBest sends action_type=best with best_photo_id and auto_reject list', async () => {
    await api.commitBest(3, 9, 100, [101, 102]);

    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/commits',
      {
        branch_id: 3,
        action_type: 'best',
        payload: { group_id: 9, best_photo_id: 100, auto_reject: [101, 102] },
      }
    );
  });

  it('importDirectory POSTs directory_path', async () => {
    await api.importDirectory('/some/folder');

    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/library/import',
      { directory_path: '/some/folder' }
    );
  });
});
