from sqlalchemy.orm import Session
import models


def get_branch_state(db: Session, branch_id: int):
    """Replay all commits on a branch and return {photo_id: decision}.

    Decisions: 'keep' | 'reject' | 'skip' | 'trash'. Trash is an overlay —
    a trashed photo's underlying keep/reject is preserved internally, so an
    `untrash` commit cleanly restores the prior decision.
    """
    branch = db.query(models.Branch).filter(models.Branch.id == branch_id).first()
    if not branch:
        return {}

    commits = []
    current_commit_id = branch.head_commit_id
    while current_commit_id:
        commit = db.query(models.Commit).filter(models.Commit.id == current_commit_id).first()
        if not commit:
            break
        commits.insert(0, commit)
        current_commit_id = commit.parent_commit_id

    state = {}
    trashed = set()
    for commit in commits:
        payload = commit.payload or {}
        if commit.action_type == "decide":
            photo_id = payload.get("photo_id")
            decision = payload.get("decision")
            if photo_id and decision:
                state[photo_id] = decision
        elif commit.action_type == "best":
            best_id = payload.get("best_photo_id")
            auto_reject = payload.get("auto_reject", [])
            if best_id:
                # 'best' is its own state value (not 'keep') so the UI can
                # render a Star icon. Downloads/exports still include it
                # alongside 'keep'.
                state[best_id] = "best"
            for r_id in auto_reject:
                state[r_id] = "reject"
        elif commit.action_type == "restore":
            photo_id = payload.get("photo_id")
            if photo_id:
                state[photo_id] = "keep"
        elif commit.action_type == "trash":
            for pid in payload.get("photo_ids", []):
                trashed.add(pid)
        elif commit.action_type == "untrash":
            for pid in payload.get("photo_ids", []):
                trashed.discard(pid)

    # Overlay trash on top of the underlying decisions.
    for pid in trashed:
        state[pid] = "trash"

    return state
