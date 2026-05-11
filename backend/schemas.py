from pydantic import BaseModel
from typing import Optional, Any, Dict, List

class PhotoBase(BaseModel):
    absolute_path: str
    content_hash: str
    timestamp: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    group_id: Optional[int] = None

class Photo(PhotoBase):
    id: int

    class Config:
        from_attributes = True

class ImportRequest(BaseModel):
    directory_path: str

class BranchBase(BaseModel):
    name: str

class BranchCreate(BranchBase):
    parent_branch_id: Optional[int] = None
    parent_commit_id: Optional[int] = None

class Branch(BranchBase):
    id: int
    parent_branch_id: Optional[int] = None
    parent_commit_id: Optional[int] = None
    head_commit_id: Optional[int] = None

    class Config:
        from_attributes = True

class CommitBase(BaseModel):
    branch_id: int
    action_type: str
    payload: Dict[str, Any]

class CommitCreate(CommitBase):
    pass

class Commit(CommitBase):
    id: int
    parent_commit_id: Optional[int] = None
    timestamp: float

    class Config:
        from_attributes = True

class ExportRequest(BaseModel):
    branch_id: int
    destination_path: str
