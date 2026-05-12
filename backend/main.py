from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from pathlib import Path, PurePath
from typing import List, Dict
from PIL import Image, ImageOps
import io
import time
import shutil
import os
import zipfile

# Register HEIF/HEIC opener with Pillow (iPhone photos arrive as HEIC).
# Optional — if the install failed for some reason, HEIC files just won't
# open and the upload skips them gracefully.
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

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

# Drag-and-drop uploads land here. Files are saved to a fresh timestamped
# batch directory under the user's home so the working copies live alongside
# their other photo folders, then the existing indexer is kicked off.
UPLOADS_ROOT = Path.home() / "Pictures" / "photo-culler-uploads"


def _save_as_jpeg(src_bytes: bytes, dest_path: Path) -> bool:
    """Open arbitrary image bytes with Pillow and write a JPEG to dest_path.

    Returns True on success. Handles RGBA/LA/P modes by compositing on white
    (JPEG has no alpha). Preserves EXIF when present so the indexer's
    orientation fix still works.
    """
    try:
        with Image.open(io.BytesIO(src_bytes)) as img:
            img.load()
            exif = img.info.get("exif", b"")
            if img.mode in ("RGBA", "LA"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[-1])
                out = bg
            elif img.mode == "P":
                out = img.convert("RGBA")
                bg = Image.new("RGB", out.size, (255, 255, 255))
                bg.paste(out, mask=out.split()[-1])
                out = bg
            elif img.mode != "RGB":
                out = img.convert("RGB")
            else:
                out = img
            out.save(dest_path, "JPEG", quality=92, exif=exif)
        return True
    except Exception as e:
        print(f"Could not convert image to JPEG: {e}")
        return False


@app.post("/api/library/upload")
async def upload_photos(files: List[UploadFile] = File(...)):
    """Accept any image format; convert anything non-JPEG to JPEG so the
    rest of the pipeline (which is JPEG-only) can index it. Non-image
    drops are skipped, not errored, so a stray PDF in a folder of photos
    doesn't fail the whole upload.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    target_dir = UPLOADS_ROOT / f"batch-{int(time.time())}"
    target_dir.mkdir(parents=True, exist_ok=True)

    saved = 0
    converted = 0
    skipped = 0

    for f in files:
        if not f.filename:
            skipped += 1
            continue
        # Read once into memory; we may need to inspect it twice (header
        # check + write/convert).
        data = await f.read()
        if not data:
            skipped += 1
            continue

        stem = PurePath(f.filename).stem or "image"
        ext = PurePath(f.filename).suffix.lower()
        dest = target_dir / f"{stem}.jpg"
        # Disambiguate so two PNGs named "screenshot" don't collide as
        # "screenshot.jpg".
        n = 1
        while dest.exists():
            dest = target_dir / f"{stem}_{n}.jpg"
            n += 1

        # Fast path: real JPEGs go through as bytes (preserves EXIF exactly,
        # no re-encode loss).
        is_jpeg_ext = ext in (".jpg", ".jpeg")
        is_jpeg_magic = len(data) >= 3 and data[:3] == b"\xff\xd8\xff"
        if is_jpeg_ext and is_jpeg_magic:
            with open(dest, "wb") as out:
                out.write(data)
            saved += 1
            continue

        # Anything else: try to open + convert via Pillow.
        if _save_as_jpeg(data, dest):
            saved += 1
            converted += 1
        else:
            skipped += 1

    if saved == 0:
        try:
            target_dir.rmdir()
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="No usable images in upload")

    indexer.start_import(str(target_dir))
    return {
        "saved": saved,
        "skipped": skipped,
        "converted": converted,
        "directory": str(target_dir),
    }


@app.post("/api/library/regenerate-thumbnails")
def regenerate_thumbnails(db: Session = Depends(get_db)):
    return indexer.regenerate_all_thumbnails(db)

@app.get("/api/photos", response_model=List[schemas.Photo])
def get_photos(db: Session = Depends(get_db)):
    return db.query(models.Photo).all()

@app.post("/api/photos/delete")
def delete_photos(request: schemas.DeletePhotosRequest, db: Session = Depends(get_db)):
    """Permanently remove photos from the app (DB row + generated thumbnails).

    Original files on disk are never touched — the PRD's 'read-only originals'
    rule is enforced here. Re-importing the folder will re-index the photos.
    """
    if not request.photo_ids:
        return {"deleted": 0, "missing": 0}

    photos = db.query(models.Photo).filter(models.Photo.id.in_(request.photo_ids)).all()
    found_ids = {p.id for p in photos}
    missing = len(set(request.photo_ids)) - len(found_ids)

    for photo in photos:
        # Best-effort thumbnail cleanup; missing thumbs are not an error.
        base_dir = os.path.dirname(photo.absolute_path)
        for size_name in indexer.THUMBNAIL_SIZES.keys():
            thumb_path = os.path.join(
                base_dir, indexer.THUMBNAIL_DIR, f"{photo.content_hash}_{size_name}.jpg",
            )
            try:
                if os.path.exists(thumb_path):
                    os.remove(thumb_path)
            except OSError:
                pass  # surface as a backend log only, not an HTTP error
        db.delete(photo)
    db.commit()

    return {"deleted": len(photos), "missing": missing}


@app.post("/api/photos/regroup")
def regroup_photos(request: schemas.RegroupRequest, db: Session = Depends(get_db)):
    """Assign every photo in `photo_ids` the same group_id.

    Picks the smallest existing group_id among the selection as the merge
    target — so merging Group 5 + Group 7 produces Group 5, which matches
    most users' intuition. If none of the selected photos have a group yet,
    a fresh group_id is allocated from max+1.

    Note: this mutates `photos.group_id`. The 'immutable photos' principle
    in the PRD is about file-level safety (never modify originals); group_id
    is heuristic metadata that the auto-indexer guesses, and this endpoint
    is the way users override that guess.
    """
    if len(request.photo_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 photos to merge")

    photos = db.query(models.Photo).filter(models.Photo.id.in_(request.photo_ids)).all()
    if len(photos) != len(request.photo_ids):
        raise HTTPException(status_code=404, detail="One or more photos not found")

    existing = [p.group_id for p in photos if p.group_id is not None]
    if existing:
        target = min(existing)
    else:
        max_row = db.query(models.Photo).order_by(models.Photo.group_id.desc()).first()
        target = (max_row.group_id + 1) if (max_row and max_row.group_id) else 1

    changed = 0
    for p in photos:
        if p.group_id != target:
            p.group_id = target
            changed += 1
    db.commit()

    return {"group_id": target, "updated": changed, "size": len(photos)}

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

@app.delete("/api/branches/{branch_id}")
def delete_branch(branch_id: int, db: Session = Depends(get_db)):
    """Delete a branch and all of its commits.

    Refuses if it's the only branch, or if other branches have forked from it
    (their parent_branch_id points here). Commits on this branch are wiped;
    photo rows are never touched.
    """
    branch = db.query(models.Branch).filter(models.Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    total = db.query(models.Branch).count()
    if total <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last remaining branch")

    forks = (
        db.query(models.Branch)
        .filter(models.Branch.parent_branch_id == branch_id)
        .count()
    )
    if forks > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {forks} branch(es) forked from this one",
        )

    # Clear branch's own FK pointers so the commits can be deleted without
    # foreign-key constraint complaints (use_alter handles the cycle, but
    # we still want a clean state).
    branch.head_commit_id = None
    branch.parent_commit_id = None
    db.flush()

    deleted_commits = (
        db.query(models.Commit)
        .filter(models.Commit.branch_id == branch_id)
        .delete(synchronize_session=False)
    )
    db.delete(branch)
    db.commit()

    return {"deleted": branch_id, "deleted_commits": deleted_commits}


@app.get("/api/branches/{branch_id}/state")
def get_branch_state_endpoint(branch_id: int, db: Session = Depends(get_db)):
    state = state_engine.get_branch_state(db, branch_id)
    return state

def _append_commit_to_branch(db: Session, branch: models.Branch, action_type: str, payload: dict) -> models.Commit:
    """Append a new commit to `branch` and advance its HEAD. Shared by the
    user-facing 'commit rejects' and 'revert' endpoints so they take the
    same path as the regular POST /api/commits."""
    db_commit = models.Commit(
        branch_id=branch.id,
        parent_commit_id=branch.head_commit_id,
        timestamp=time.time(),
        action_type=action_type,
        payload=payload,
    )
    db.add(db_commit)
    db.commit()
    db.refresh(db_commit)
    branch.head_commit_id = db_commit.id
    db.commit()
    return db_commit


@app.post("/api/branches/{branch_id}/commit-rejects")
def commit_rejects(branch_id: int, db: Session = Depends(get_db)):
    """Move every currently-rejected photo on this branch to trash, as one
    revertable commit. The branch's underlying reject decisions are preserved;
    'untrash' on this commit returns the photos to their reject state.
    """
    branch = db.query(models.Branch).filter(models.Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    state = state_engine.get_branch_state(db, branch_id)
    reject_ids = [pid for pid, s in state.items() if s == "reject"]
    if not reject_ids:
        raise HTTPException(status_code=400, detail="No uncommitted rejects on this branch")

    new_commit = _append_commit_to_branch(
        db, branch, "trash", {"photo_ids": reject_ids, "source": "commit_rejects"}
    )
    return {
        "id": new_commit.id,
        "timestamp": new_commit.timestamp,
        "photo_count": len(reject_ids),
    }


@app.get("/api/branches/{branch_id}/commits")
def list_commits(branch_id: int, db: Session = Depends(get_db)):
    """List user-facing reject→trash commits for a branch. For each one, also
    report whether its photos are *currently* trashed (Active) or have been
    untrashed by a later commit (Reverted)."""
    branch = db.query(models.Branch).filter(models.Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Walk parent chain to get this branch's commits in chronological order.
    chain = []
    current_id = branch.head_commit_id
    while current_id:
        c = db.query(models.Commit).filter(models.Commit.id == current_id).first()
        if not c:
            break
        chain.insert(0, c)
        current_id = c.parent_commit_id

    state = state_engine.get_branch_state(db, branch_id)
    reverted_by = {}
    for c in chain:
        if c.action_type == "untrash":
            ref = (c.payload or {}).get("reverts_commit_id")
            if ref is not None:
                reverted_by[ref] = c.id

    out = []
    for c in chain:
        if c.action_type != "trash":
            continue
        photo_ids = (c.payload or {}).get("photo_ids", [])
        active_count = sum(1 for pid in photo_ids if state.get(pid) == "trash")
        out.append({
            "id": c.id,
            "timestamp": c.timestamp,
            "photo_count": len(photo_ids),
            "active_count": active_count,
            "is_active": active_count == len(photo_ids) and len(photo_ids) > 0,
            "reverted_by": reverted_by.get(c.id),
            "source": (c.payload or {}).get("source"),
        })
    # Most recent first — matches the user's expectation of git log.
    out.reverse()
    return out


@app.post("/api/commits/{commit_id}/revert")
def revert_commit(commit_id: int, db: Session = Depends(get_db)):
    """Issue an untrash commit that inverts a prior trash commit. Tagged with
    `reverts_commit_id` so the listing can mark the original Reverted."""
    commit = db.query(models.Commit).filter(models.Commit.id == commit_id).first()
    if not commit:
        raise HTTPException(status_code=404, detail="Commit not found")
    if commit.action_type != "trash":
        raise HTTPException(status_code=400, detail="Only trash commits can be reverted")

    photo_ids = (commit.payload or {}).get("photo_ids", [])
    if not photo_ids:
        return {"message": "Nothing to revert"}

    branch = db.query(models.Branch).filter(models.Branch.id == commit.branch_id).first()
    revert = _append_commit_to_branch(
        db, branch, "untrash",
        {"photo_ids": photo_ids, "reverts_commit_id": commit.id},
    )
    return {
        "id": revert.id,
        "reverted_commit_id": commit.id,
        "photo_count": len(photo_ids),
    }


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

@app.get("/api/branches/{branch_id}/download")
def download_filtered(branch_id: int, filter: str = "keep", db: Session = Depends(get_db)):
    """Stream a ZIP of photos matching the given filter on the branch.

    `filter` is one of: all, keep (default — keep + best), best, reject,
    skip, undecided. Trashed photos are never included.
    """
    branch = db.query(models.Branch).filter(models.Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    state = state_engine.get_branch_state(db, branch_id)
    all_photos = db.query(models.Photo).all()

    if filter == "all":
        photos = [p for p in all_photos if state.get(p.id) != "trash"]
    elif filter == "undecided":
        photos = [p for p in all_photos if p.id not in state]
    elif filter == "keep":
        ids = {pid for pid, d in state.items() if d in ("keep", "best")}
        photos = [p for p in all_photos if p.id in ids]
    elif filter in ("best", "reject", "skip"):
        ids = {pid for pid, d in state.items() if d == filter}
        photos = [p for p in all_photos if p.id in ids]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown filter '{filter}'")

    if not photos:
        raise HTTPException(status_code=404, detail=f"No photos in the '{filter}' section")

    # Drop trashed photos for any filter that doesn't explicitly want them
    # (only 'all' / 'undecided' could otherwise smuggle them in).
    photos = [p for p in photos if state.get(p.id) != "trash"]
    if not photos:
        raise HTTPException(status_code=404, detail=f"No photos in the '{filter}' section")

    buffer = io.BytesIO()
    # ZIP_STORED — JPEGs are already compressed; deflate wouldn't help and
    # would just waste CPU on large batches.
    used_names = {}
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as zf:
        for photo in photos:
            if not os.path.exists(photo.absolute_path):
                continue
            base = os.path.basename(photo.absolute_path)
            # Disambiguate same-name files from different folders.
            count = used_names.get(base, 0)
            used_names[base] = count + 1
            arcname = base if count == 0 else f"{count}_{base}"
            zf.write(photo.absolute_path, arcname=arcname)

    filename = f"{filter}-{branch.name}-{int(time.time())}.zip"
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/export")
def export_photos(request: schemas.ExportRequest, db: Session = Depends(get_db)):
    if not os.path.exists(request.destination_path):
        os.makedirs(request.destination_path, exist_ok=True)
        
    state = state_engine.get_branch_state(db, request.branch_id)
    keeps = [photo_id for photo_id, dec in state.items() if dec in ("keep", "best")]
    
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
