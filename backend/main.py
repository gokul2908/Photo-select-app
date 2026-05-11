from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict
import time
import shutil
import os

from database import SessionLocal, engine, Base
import models
import schemas
import indexer
import state_engine

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return {"message": "Local Photo Culler API is running."}

@app.post("/api/library/import")
def import_directory(request: schemas.ImportRequest):
    if not os.path.exists(request.directory_path):
        raise HTTPException(status_code=400, detail="Directory does not exist.")
    indexer.start_import(request.directory_path)
    return {"message": f"Import started for {request.directory_path}"}

@app.get("/api/library/status")
def get_import_status():
    # Placeholder for actual status tracking. 
    # To implement fully, indexer.py would need to write its progress to a global var or DB.
    return {"status": "ok", "message": "Import runs in background."}

@app.get("/api/photos", response_model=List[schemas.Photo])
def get_photos(db: Session = Depends(get_db)):
    return db.query(models.Photo).all()

@app.get("/api/photos/{photo_id}/thumbnail/{size}")
def get_photo_thumbnail(photo_id: int, size: str, db: Session = Depends(get_db)):
    photo = db.query(models.Photo).filter(models.Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
        
    if size not in indexer.THUMBNAIL_SIZES:
        raise HTTPException(status_code=400, detail="Invalid thumbnail size")
        
    # Infer base directory from the absolute path
    base_dir = os.path.dirname(photo.absolute_path)
    thumb_path = os.path.join(base_dir, indexer.THUMBNAIL_DIR, f"{photo.content_hash}_{size}.jpg")
    
    if not os.path.exists(thumb_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
        
    return FileResponse(thumb_path)

@app.get("/api/photos/{photo_id}/original")
def get_photo_original(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(models.Photo).filter(models.Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not os.path.exists(photo.absolute_path):
        raise HTTPException(status_code=404, detail="Original file not found on disk")
    return FileResponse(photo.absolute_path)

@app.get("/api/branches", response_model=List[schemas.Branch])
def get_branches(db: Session = Depends(get_db)):
    return db.query(models.Branch).all()

@app.post("/api/branches", response_model=schemas.Branch)
def create_branch(branch: schemas.BranchCreate, db: Session = Depends(get_db)):
    db_branch = models.Branch(
        name=branch.name,
        parent_branch_id=branch.parent_branch_id,
        parent_commit_id=branch.parent_commit_id,
        head_commit_id=branch.parent_commit_id  # starts at the parent commit
    )
    db.add(db_branch)
    db.commit()
    db.refresh(db_branch)
    return db_branch

@app.get("/api/branches/{branch_id}/state")
def get_branch_state_endpoint(branch_id: int, db: Session = Depends(get_db)):
    state = state_engine.get_branch_state(db, branch_id)
    return state

@app.post("/api/commits", response_model=schemas.Commit)
def create_commit(commit: schemas.CommitCreate, db: Session = Depends(get_db)):
    branch = db.query(models.Branch).filter(models.Branch.id == commit.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    db_commit = models.Commit(
        branch_id=commit.branch_id,
        parent_commit_id=branch.head_commit_id,
        timestamp=time.time(),
        action_type=commit.action_type,
        payload=commit.payload
    )
    db.add(db_commit)
    db.commit()
    db.refresh(db_commit)

    # Update branch HEAD
    branch.head_commit_id = db_commit.id
    db.commit()

    return db_commit

@app.post("/api/export")
def export_photos(request: schemas.ExportRequest, db: Session = Depends(get_db)):
    if not os.path.exists(request.destination_path):
        os.makedirs(request.destination_path, exist_ok=True)
        
    state = state_engine.get_branch_state(db, request.branch_id)
    keeps = [photo_id for photo_id, dec in state.items() if dec == "keep"]
    
    if not keeps:
        return {"message": "Nothing to export"}
        
    exported = 0
    for pid in keeps:
        photo = db.query(models.Photo).filter(models.Photo.id == pid).first()
        if photo and os.path.exists(photo.absolute_path):
            filename = os.path.basename(photo.absolute_path)
            dest = os.path.join(request.destination_path, filename)
            shutil.copy2(photo.absolute_path, dest)
            exported += 1
            
    return {"message": f"Exported {exported} photos to {request.destination_path}"}
