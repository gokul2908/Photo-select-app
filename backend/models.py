from sqlalchemy import Column, Integer, String, Float, ForeignKey, JSON
from database import Base

class Photo(Base):
    __tablename__ = "photos"
    id = Column(Integer, primary_key=True, index=True)
    absolute_path = Column(String, unique=True, index=True)
    content_hash = Column(String, index=True)
    timestamp = Column(Float, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    group_id = Column(Integer, index=True, nullable=True)

class Branch(Base):
    __tablename__ = "branches"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    parent_branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    parent_commit_id = Column(Integer, ForeignKey("commits.id", use_alter=True), nullable=True)
    head_commit_id = Column(Integer, ForeignKey("commits.id", use_alter=True), nullable=True)

class Commit(Base):
    __tablename__ = "commits"
    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"))
    parent_commit_id = Column(Integer, ForeignKey("commits.id"), nullable=True)
    timestamp = Column(Float)
    action_type = Column(String)  # decide, best, restore
    payload = Column(JSON)  # {"photo_id": 42, "decision": "keep"}
