import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getPhotos: vi.fn(),
    getBranches: vi.fn(),
    getBranchState: vi.fn(),
    commitDecision: vi.fn(),
    commitBest: vi.fn(),
    commitTrash: vi.fn(),
    commitUntrash: vi.fn(),
    mergeGroups: vi.fn(),
    permanentlyDelete: vi.fn(),
    commitRejects: vi.fn(),
    listCommits: vi.fn(),
    revertCommit: vi.fn(),
    deleteBranch: vi.fn(),
  },
}));

vi.mock('./api', () => ({ api: mockApi }));

import { AppProvider, useAppContext } from './AppContext';

const PHOTOS = [
  { id: 1, group_id: 1, absolute_path: '/a.jpg' },
  { id: 2, group_id: 1, absolute_path: '/b.jpg' },
  { id: 3, group_id: 2, absolute_path: '/c.jpg' },
];

const BRANCHES = [{ id: 10, name: 'main', head_commit_id: null }];

function Harness() {
  const ctx = useAppContext();
  if (ctx.isLoading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="currentIndex">{ctx.currentIndex}</div>
      <div data-testid="currentBranch">{ctx.currentBranch ?? 'none'}</div>
      <div data-testid="state">{JSON.stringify(ctx.branchState)}</div>
      <button onClick={() => ctx.makeDecision(PHOTOS[ctx.currentIndex].id, 'keep')}>keep</button>
      <button onClick={() => ctx.makeDecision(PHOTOS[ctx.currentIndex].id, 'reject')}>reject</button>
      <button onClick={() => ctx.markBest(PHOTOS[ctx.currentIndex].group_id, PHOTOS[ctx.currentIndex].id)}>best</button>
      <button onClick={() => ctx.trashPhotos([1, 2])}>trash-1-2</button>
      <button onClick={() => ctx.restorePhotos([1])}>restore-1</button>
      <button onClick={() => ctx.mergeIntoOneGroup([1, 3])}>merge-1-3</button>
      <button onClick={() => ctx.mergeIntoOneGroup([1])}>merge-1-only</button>
      <button onClick={() => ctx.permanentlyDeletePhotos([1, 2])}>perma-delete-1-2</button>
      <button onClick={() => ctx.commitCurrentRejects()}>commit-rejects</button>
      <button onClick={() => ctx.revertCommit(7)}>revert-7</button>
      <button onClick={() => ctx.deleteBranch(10)}>delete-active-branch</button>
      <div data-testid="photos-count">{ctx.photos.length}</div>
      <div data-testid="commits-count">{ctx.commits.length}</div>
      <div data-testid="branches-count">{ctx.branches.length}</div>
    </div>
  );
}

async function renderApp() {
  let utils;
  await act(async () => {
    utils = render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );
  });
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getPhotos.mockResolvedValue({ data: PHOTOS });
  mockApi.getBranches.mockResolvedValue({ data: BRANCHES });
  mockApi.getBranchState.mockResolvedValue({ data: {} });
  mockApi.commitDecision.mockResolvedValue({});
  mockApi.commitBest.mockResolvedValue({});
  mockApi.commitTrash.mockResolvedValue({});
  mockApi.commitUntrash.mockResolvedValue({});
  mockApi.mergeGroups.mockResolvedValue({ data: { group_id: 1, updated: 2 } });
  mockApi.permanentlyDelete.mockResolvedValue({ data: { deleted: 0, missing: 0 } });
  mockApi.commitRejects.mockResolvedValue({ data: { id: 7, timestamp: 1234, photo_count: 2 } });
  mockApi.listCommits.mockResolvedValue({ data: [] });
  mockApi.revertCommit.mockResolvedValue({ data: {} });
  mockApi.deleteBranch.mockResolvedValue({ data: { deleted: 1 } });
});

describe('AppContext bootstrap', () => {
  it('loads photos, branches, and selects the main branch by default', async () => {
    await renderApp();

    expect(mockApi.getPhotos).toHaveBeenCalledOnce();
    expect(mockApi.getBranches).toHaveBeenCalledOnce();
    expect(mockApi.getBranchState).toHaveBeenCalledWith(10);
    expect(screen.getByTestId('currentBranch')).toHaveTextContent('10');
  });
});

describe('makeDecision', () => {
  it('optimistically applies the decision and advances currentIndex', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByText('keep'));

    expect(screen.getByTestId('state')).toHaveTextContent(JSON.stringify({ 1: 'keep' }));
    expect(screen.getByTestId('currentIndex')).toHaveTextContent('1');
    expect(mockApi.commitDecision).toHaveBeenCalledWith(10, 1, 'keep');
  });

  it('does not advance past the last photo', async () => {
    const user = userEvent.setup();
    await renderApp();

    // Advance through all photos
    await user.click(screen.getByText('keep'));
    await user.click(screen.getByText('keep'));
    await user.click(screen.getByText('keep')); // already on last photo

    expect(screen.getByTestId('currentIndex')).toHaveTextContent('2');
  });
});

describe('markBest', () => {
  it('marks the best photo keep, auto-rejects siblings, jumps to next group', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByText('best')); // group 1, best = photo 1

    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state).toEqual({ 1: 'best', 2: 'reject' });

    // Photo 3 is the first photo of the next group (group_id 2) — index 2
    expect(screen.getByTestId('currentIndex')).toHaveTextContent('2');

    expect(mockApi.commitBest).toHaveBeenCalledWith(10, 1, 1, [2]);
  });
});

describe('deleteBranch', () => {
  it('calls the API and falls back to a remaining branch if the deleted one was active', async () => {
    const user = userEvent.setup();
    // After deletion, getBranches returns just the remaining one.
    mockApi.getBranches
      .mockResolvedValueOnce({ data: BRANCHES }) // initial
      .mockResolvedValueOnce({ data: [{ id: 11, name: 'main', head_commit_id: null }] });
    mockApi.getBranchState
      .mockResolvedValueOnce({ data: {} }) // initial for branch 10
      .mockResolvedValueOnce({ data: {} }); // after fallback to branch 11

    await renderApp();
    expect(screen.getByTestId('currentBranch')).toHaveTextContent('10');

    await user.click(screen.getByText('delete-active-branch'));

    expect(mockApi.deleteBranch).toHaveBeenCalledWith(10);
    expect(screen.getByTestId('currentBranch')).toHaveTextContent('11');
    expect(screen.getByTestId('branches-count')).toHaveTextContent('1');
  });

});

describe('commits', () => {
  it('selectBranch fetches state and commits in parallel', async () => {
    await renderApp();
    expect(mockApi.listCommits).toHaveBeenCalledWith(10);
    expect(mockApi.getBranchState).toHaveBeenCalledWith(10);
  });

  it('commitCurrentRejects POSTs and refreshes commits + state', async () => {
    const user = userEvent.setup();
    mockApi.listCommits
      .mockResolvedValueOnce({ data: [] })  // initial selectBranch
      .mockResolvedValueOnce({ data: [{ id: 7, timestamp: 1234, photo_count: 2, is_active: true, reverted_by: null }] });
    mockApi.getBranchState
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { 1: 'trash', 2: 'trash' } });

    await renderApp();
    expect(screen.getByTestId('commits-count')).toHaveTextContent('0');

    await user.click(screen.getByText('commit-rejects'));

    expect(mockApi.commitRejects).toHaveBeenCalledWith(10);
    expect(screen.getByTestId('commits-count')).toHaveTextContent('1');
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state).toEqual({ 1: 'trash', 2: 'trash' });
  });

  it('revertCommit POSTs and refreshes commits + state', async () => {
    const user = userEvent.setup();
    mockApi.listCommits
      .mockResolvedValueOnce({ data: [{ id: 7, timestamp: 1234, photo_count: 1, is_active: true, reverted_by: null }] })
      .mockResolvedValueOnce({ data: [{ id: 7, timestamp: 1234, photo_count: 1, is_active: false, reverted_by: 8 }] });
    mockApi.getBranchState
      .mockResolvedValueOnce({ data: { 1: 'trash' } })
      .mockResolvedValueOnce({ data: { 1: 'reject' } });

    await renderApp();
    await user.click(screen.getByText('revert-7'));

    expect(mockApi.revertCommit).toHaveBeenCalledWith(7);
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state).toEqual({ 1: 'reject' });
  });
});

describe('permanentlyDeletePhotos', () => {
  it('optimistically removes photos and clears their branchState', async () => {
    const user = userEvent.setup();
    // Seed with prior decisions so we can verify their state is cleared.
    mockApi.getBranchState.mockResolvedValueOnce({ data: { 1: 'trash', 2: 'trash', 3: 'keep' } });

    await renderApp();
    expect(screen.getByTestId('photos-count')).toHaveTextContent('3');

    await user.click(screen.getByText('perma-delete-1-2'));

    expect(mockApi.permanentlyDelete).toHaveBeenCalledWith([1, 2]);
    expect(screen.getByTestId('photos-count')).toHaveTextContent('1');
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state).toEqual({ 3: 'keep' });
  });
});

describe('mergeIntoOneGroup', () => {
  it('posts the photo ids and refreshes the photos list so new groupings show', async () => {
    const user = userEvent.setup();
    // First getPhotos call is the bootstrap; second is the post-merge refresh.
    mockApi.getPhotos
      .mockResolvedValueOnce({ data: PHOTOS })
      .mockResolvedValueOnce({
        data: [
          { id: 1, group_id: 1, absolute_path: '/a.jpg' },
          { id: 2, group_id: 1, absolute_path: '/b.jpg' },
          { id: 3, group_id: 1, absolute_path: '/c.jpg' }, // moved from group 2 → 1
        ],
      });

    await renderApp();
    await user.click(screen.getByText('merge-1-3'));

    expect(mockApi.mergeGroups).toHaveBeenCalledWith([1, 3]);
    // Refresh fired
    expect(mockApi.getPhotos).toHaveBeenCalledTimes(2);
  });

  it('no-ops when fewer than 2 photo ids are passed', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByText('merge-1-only'));
    expect(mockApi.mergeGroups).not.toHaveBeenCalled();
  });
});

describe('trash + restore', () => {
  it('trashPhotos optimistically marks photos as trash and posts a trash commit', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByText('trash-1-2'));

    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state).toEqual({ 1: 'trash', 2: 'trash' });
    expect(mockApi.commitTrash).toHaveBeenCalledWith(10, [1, 2]);
  });

  it('restorePhotos clears the trash flag and refetches branch state', async () => {
    const user = userEvent.setup();
    // Server says photo 1 is back to "keep" after the untrash commit.
    mockApi.getBranchState
      .mockResolvedValueOnce({ data: {} }) // initial bootstrap
      .mockResolvedValueOnce({ data: { 1: 'keep', 2: 'trash' } }); // after untrash refetch

    await renderApp();
    await user.click(screen.getByText('trash-1-2')); // makes 1 and 2 trash locally
    await user.click(screen.getByText('restore-1')); // restores 1

    expect(mockApi.commitUntrash).toHaveBeenCalledWith(10, [1]);
    // Final state comes from the refetch.
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state).toEqual({ 1: 'keep', 2: 'trash' });
  });
});
