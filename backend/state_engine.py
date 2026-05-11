from sqlalchemy.orm import Session
import models
import json

def get_branch_state(db: Session, branch_id: int):
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
                state[best_id] = "keep"
            for r_id in auto_reject:
                state[r_id] = "reject"
        elif commit.action_type == "restore":
            photo_id = payload.get("photo_id")
            if photo_id:
                state[photo_id] = "keep"
            
    return state
