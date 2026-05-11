"""Tests for state_engine.get_branch_state — the commit-replay logic."""
import time

import models
import state_engine


def _seed_branch(db, name="main"):
    branch = models.Branch(name=name)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def _append_commit(db, branch, action_type, payload):
    commit = models.Commit(
        branch_id=branch.id,
        parent_commit_id=branch.head_commit_id,
        timestamp=time.time(),
        action_type=action_type,
        payload=payload,
    )
    db.add(commit)
    db.commit()
    db.refresh(commit)
    branch.head_commit_id = commit.id
    db.commit()
    return commit


def test_empty_branch_returns_empty_state(db_session):
    branch = _seed_branch(db_session)
    assert state_engine.get_branch_state(db_session, branch.id) == {}


def test_decide_records_keep_then_reject(db_session):
    branch = _seed_branch(db_session)
    _append_commit(db_session, branch, "decide", {"photo_id": 1, "decision": "keep"})
    _append_commit(db_session, branch, "decide", {"photo_id": 2, "decision": "reject"})

    state = state_engine.get_branch_state(db_session, branch.id)
    assert state == {1: "keep", 2: "reject"}


def test_later_commit_overrides_earlier(db_session):
    branch = _seed_branch(db_session)
    _append_commit(db_session, branch, "decide", {"photo_id": 5, "decision": "reject"})
    _append_commit(db_session, branch, "decide", {"photo_id": 5, "decision": "keep"})

    assert state_engine.get_branch_state(db_session, branch.id) == {5: "keep"}


def test_best_action_marks_best_and_rejects_siblings(db_session):
    branch = _seed_branch(db_session)
    _append_commit(
        db_session,
        branch,
        "best",
        {"group_id": 1, "best_photo_id": 10, "auto_reject": [11, 12]},
    )

    state = state_engine.get_branch_state(db_session, branch.id)
    # 'best' is distinct from 'keep' so the UI can render it differently;
    # downloads still include both.
    assert state == {10: "best", 11: "reject", 12: "reject"}


def test_restore_flips_reject_to_keep(db_session):
    branch = _seed_branch(db_session)
    _append_commit(db_session, branch, "decide", {"photo_id": 7, "decision": "reject"})
    _append_commit(db_session, branch, "restore", {"photo_id": 7})

    assert state_engine.get_branch_state(db_session, branch.id) == {7: "keep"}


def test_unknown_branch_returns_empty_state(db_session):
    assert state_engine.get_branch_state(db_session, 999) == {}


def test_trash_overlays_decision(db_session):
    branch = _seed_branch(db_session)
    _append_commit(db_session, branch, "decide", {"photo_id": 5, "decision": "keep"})
    _append_commit(db_session, branch, "trash", {"photo_ids": [5]})

    assert state_engine.get_branch_state(db_session, branch.id) == {5: "trash"}


def test_untrash_restores_underlying_decision(db_session):
    branch = _seed_branch(db_session)
    _append_commit(db_session, branch, "decide", {"photo_id": 5, "decision": "keep"})
    _append_commit(db_session, branch, "trash", {"photo_ids": [5]})
    _append_commit(db_session, branch, "untrash", {"photo_ids": [5]})

    assert state_engine.get_branch_state(db_session, branch.id) == {5: "keep"}


def test_trash_batch_then_partial_untrash(db_session):
    branch = _seed_branch(db_session)
    _append_commit(db_session, branch, "decide", {"photo_id": 1, "decision": "keep"})
    _append_commit(db_session, branch, "decide", {"photo_id": 2, "decision": "reject"})
    _append_commit(db_session, branch, "trash", {"photo_ids": [1, 2]})
    _append_commit(db_session, branch, "untrash", {"photo_ids": [2]})

    state = state_engine.get_branch_state(db_session, branch.id)
    assert state == {1: "trash", 2: "reject"}
