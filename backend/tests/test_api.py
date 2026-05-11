"""End-to-end-ish tests for the FastAPI surface.

These hit the live FastAPI app via TestClient. The conftest swaps the engine
to in-memory SQLite, so we drive the same code paths uvicorn would, just
without disk I/O.
"""
import io
import zipfile

from PIL import Image

import models


def test_root_health(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json() == {"message": "Local Photo Culler API is running."}


def test_photos_empty_by_default(client):
    r = client.get("/api/photos")
    assert r.status_code == 200
    assert r.json() == []


def test_import_rejects_missing_directory(client):
    r = client.post("/api/library/import", json={"directory_path": "/nope/does/not/exist"})
    assert r.status_code == 400
    assert "does not exist" in r.json()["detail"]


def test_thumbnail_404_for_unknown_photo(client):
    r = client.get("/api/photos/999/thumbnail/main")
    assert r.status_code == 404


def test_thumbnail_400_for_invalid_size(client, db_session):
    photo = models.Photo(absolute_path="/fake/path.jpg", content_hash="abc")
    db_session.add(photo)
    db_session.commit()
    db_session.refresh(photo)

    r = client.get(f"/api/photos/{photo.id}/thumbnail/giant")
    assert r.status_code == 400


def test_branch_lifecycle(client):
    # Empty initially
    assert client.get("/api/branches").json() == []

    # Create a branch
    r = client.post("/api/branches", json={"name": "main"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "main"
    assert body["head_commit_id"] is None
    branch_id = body["id"]

    # Now visible in the list
    listed = client.get("/api/branches").json()
    assert [b["name"] for b in listed] == ["main"]

    # Empty state on a fresh branch
    state = client.get(f"/api/branches/{branch_id}/state").json()
    assert state == {}


def test_decide_commit_advances_branch_head_and_state(client):
    branch_id = client.post("/api/branches", json={"name": "session-1"}).json()["id"]

    r = client.post(
        "/api/commits",
        json={
            "branch_id": branch_id,
            "action_type": "decide",
            "payload": {"photo_id": 42, "decision": "keep"},
        },
    )
    assert r.status_code == 200
    commit_id = r.json()["id"]

    # Branch HEAD should now point at the new commit
    branch_after = next(
        b for b in client.get("/api/branches").json() if b["id"] == branch_id
    )
    assert branch_after["head_commit_id"] == commit_id

    # And the computed state reflects the decision (JSON keys come back as str)
    state = client.get(f"/api/branches/{branch_id}/state").json()
    assert state == {"42": "keep"}


def test_commit_against_unknown_branch_404s(client):
    r = client.post(
        "/api/commits",
        json={
            "branch_id": 9999,
            "action_type": "decide",
            "payload": {"photo_id": 1, "decision": "keep"},
        },
    )
    assert r.status_code == 404


def test_best_action_through_api(client):
    branch_id = client.post("/api/branches", json={"name": "best-test"}).json()["id"]

    client.post(
        "/api/commits",
        json={
            "branch_id": branch_id,
            "action_type": "best",
            "payload": {"group_id": 1, "best_photo_id": 1, "auto_reject": [2, 3]},
        },
    )

    state = client.get(f"/api/branches/{branch_id}/state").json()
    assert state == {"1": "best", "2": "reject", "3": "reject"}


def test_export_to_empty_branch_is_noop(client, tmp_path):
    branch_id = client.post("/api/branches", json={"name": "empty"}).json()["id"]

    r = client.post(
        "/api/export",
        json={"branch_id": branch_id, "destination_path": str(tmp_path)},
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Nothing to export"
    assert list(tmp_path.iterdir()) == []


def test_regenerate_thumbnails_endpoint_returns_counts(client):
    r = client.post("/api/library/regenerate-thumbnails")
    assert r.status_code == 200
    body = r.json()
    assert body == {"regenerated": 0, "missing": 0}


def test_regenerate_thumbnails_reports_missing_originals(client, db_session):
    db_session.add(models.Photo(absolute_path="/nope/not-here.jpg", content_hash="x"))
    db_session.commit()

    body = client.post("/api/library/regenerate-thumbnails").json()
    assert body == {"regenerated": 0, "missing": 1}


def _write_jpeg(path, color):
    Image.new("RGB", (50, 50), color=color).save(path, "JPEG")


def test_download_kept_streams_zip_of_kept_photos(client, db_session, tmp_path):
    # Two real JPEGs on disk; one will be kept, one rejected.
    keep_path = tmp_path / "keep_me.jpg"
    reject_path = tmp_path / "reject_me.jpg"
    _write_jpeg(keep_path, (255, 0, 0))
    _write_jpeg(reject_path, (0, 0, 255))

    db_session.add_all([
        models.Photo(absolute_path=str(keep_path), content_hash="a"),
        models.Photo(absolute_path=str(reject_path), content_hash="b"),
    ])
    db_session.commit()
    photos = db_session.query(models.Photo).all()
    keep_id = next(p.id for p in photos if p.absolute_path == str(keep_path))
    reject_id = next(p.id for p in photos if p.absolute_path == str(reject_path))

    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "decide",
        "payload": {"photo_id": keep_id, "decision": "keep"},
    })
    client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "decide",
        "payload": {"photo_id": reject_id, "decision": "reject"},
    })

    r = client.get(f"/api/branches/{branch_id}/download")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
    assert names == ["keep_me.jpg"]


def test_download_kept_includes_best_photos(client, db_session, tmp_path):
    keep_path = tmp_path / "keep.jpg"
    best_path = tmp_path / "best.jpg"
    _write_jpeg(keep_path, (255, 0, 0))
    _write_jpeg(best_path, (0, 255, 0))
    db_session.add_all([
        models.Photo(absolute_path=str(keep_path), content_hash="a"),
        models.Photo(absolute_path=str(best_path), content_hash="b"),
    ])
    db_session.commit()
    photos = db_session.query(models.Photo).all()
    keep_id = next(p.id for p in photos if p.absolute_path == str(keep_path))
    best_id = next(p.id for p in photos if p.absolute_path == str(best_path))

    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "decide",
        "payload": {"photo_id": keep_id, "decision": "keep"},
    })
    client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "best",
        "payload": {"group_id": 1, "best_photo_id": best_id, "auto_reject": []},
    })

    r = client.get(f"/api/branches/{branch_id}/download")
    assert r.status_code == 200
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = sorted(zf.namelist())
    assert names == ["best.jpg", "keep.jpg"]


def test_download_kept_excludes_trashed_photos(client, db_session, tmp_path):
    keep_path = tmp_path / "kept.jpg"
    _write_jpeg(keep_path, (0, 255, 0))
    db_session.add(models.Photo(absolute_path=str(keep_path), content_hash="a"))
    db_session.commit()
    keep_id = db_session.query(models.Photo).first().id

    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "decide",
        "payload": {"photo_id": keep_id, "decision": "keep"},
    })
    # Trash overlays the keep — download should now find nothing.
    client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "trash",
        "payload": {"photo_ids": [keep_id]},
    })

    r = client.get(f"/api/branches/{branch_id}/download")
    assert r.status_code == 404


def test_download_kept_404_when_no_kept_photos(client):
    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    r = client.get(f"/api/branches/{branch_id}/download")
    assert r.status_code == 404


def test_download_kept_404_for_unknown_branch(client):
    r = client.get("/api/branches/999/download")
    assert r.status_code == 404


def _seed_photo(db, path, group_id):
    p = models.Photo(absolute_path=path, content_hash=path, group_id=group_id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def test_regroup_merges_into_smallest_group(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 5)
    b = _seed_photo(db_session, "/b.jpg", 5)  # already in 5
    c = _seed_photo(db_session, "/c.jpg", 7)
    d = _seed_photo(db_session, "/d.jpg", 7)

    r = client.post("/api/photos/regroup", json={"photo_ids": [b.id, c.id]})
    assert r.status_code == 200
    body = r.json()
    assert body["group_id"] == 5
    assert body["size"] == 2

    db_session.expire_all()
    assert db_session.get(models.Photo, b.id).group_id == 5
    assert db_session.get(models.Photo, c.id).group_id == 5  # moved
    # Unselected photos are untouched.
    assert db_session.get(models.Photo, a.id).group_id == 5
    assert db_session.get(models.Photo, d.id).group_id == 7


def test_regroup_requires_at_least_two_photos(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    r = client.post("/api/photos/regroup", json={"photo_ids": [a.id]})
    assert r.status_code == 400


def test_regroup_404_when_a_photo_id_is_unknown(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    r = client.post("/api/photos/regroup", json={"photo_ids": [a.id, 9999]})
    assert r.status_code == 404


def test_permanent_delete_removes_photo_row_and_thumbnails(client, db_session, tmp_path):
    # Set up: photo file + both thumbnails on disk + DB row.
    photo_path = tmp_path / "p.jpg"
    photo_path.write_bytes(b"original")
    thumb_dir = tmp_path / ".photocull" / "thumbnails"
    thumb_dir.mkdir(parents=True)
    strip = thumb_dir / "abc_strip.jpg"
    main_thumb = thumb_dir / "abc_main.jpg"
    strip.write_bytes(b"strip")
    main_thumb.write_bytes(b"main")

    photo = models.Photo(absolute_path=str(photo_path), content_hash="abc")
    db_session.add(photo)
    db_session.commit()
    pid = photo.id

    r = client.post("/api/photos/delete", json={"photo_ids": [pid]})
    assert r.status_code == 200
    assert r.json() == {"deleted": 1, "missing": 0}

    # DB row gone, thumbnails gone, original file untouched.
    assert db_session.get(models.Photo, pid) is None
    assert not strip.exists()
    assert not main_thumb.exists()
    assert photo_path.exists(), "Original file must not be touched by delete"


def test_permanent_delete_reports_missing_ids(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    r = client.post("/api/photos/delete", json={"photo_ids": [a.id, 9999, 8888]})
    assert r.status_code == 200
    assert r.json() == {"deleted": 1, "missing": 2}


def test_permanent_delete_empty_list_is_noop(client):
    r = client.post("/api/photos/delete", json={"photo_ids": []})
    assert r.status_code == 200
    assert r.json() == {"deleted": 0, "missing": 0}


def test_commit_rejects_trashes_rejected_photos(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    b = _seed_photo(db_session, "/b.jpg", 1)
    c = _seed_photo(db_session, "/c.jpg", 2)
    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    # a kept, b and c rejected.
    client.post("/api/commits", json={"branch_id": branch_id, "action_type": "decide",
                                       "payload": {"photo_id": a.id, "decision": "keep"}})
    client.post("/api/commits", json={"branch_id": branch_id, "action_type": "decide",
                                       "payload": {"photo_id": b.id, "decision": "reject"}})
    client.post("/api/commits", json={"branch_id": branch_id, "action_type": "decide",
                                       "payload": {"photo_id": c.id, "decision": "reject"}})

    r = client.post(f"/api/branches/{branch_id}/commit-rejects")
    assert r.status_code == 200
    body = r.json()
    assert body["photo_count"] == 2

    # State now reads trash for rejects, keep for the kept one.
    state = client.get(f"/api/branches/{branch_id}/state").json()
    assert state[str(b.id)] == "trash"
    assert state[str(c.id)] == "trash"
    assert state[str(a.id)] == "keep"


def test_commit_rejects_400_when_no_rejects(client):
    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    r = client.post(f"/api/branches/{branch_id}/commit-rejects")
    assert r.status_code == 400


def test_list_commits_shows_only_trash_commits_in_recency_order(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    b = _seed_photo(db_session, "/b.jpg", 1)
    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    client.post("/api/commits", json={"branch_id": branch_id, "action_type": "decide",
                                       "payload": {"photo_id": a.id, "decision": "reject"}})
    first = client.post(f"/api/branches/{branch_id}/commit-rejects").json()
    client.post("/api/commits", json={"branch_id": branch_id, "action_type": "decide",
                                       "payload": {"photo_id": b.id, "decision": "reject"}})
    second = client.post(f"/api/branches/{branch_id}/commit-rejects").json()

    commits = client.get(f"/api/branches/{branch_id}/commits").json()
    # Most recent first.
    assert [c["id"] for c in commits] == [second["id"], first["id"]]
    # Both are active (their photos are still trashed).
    assert all(c["is_active"] for c in commits)
    assert all(c["reverted_by"] is None for c in commits)


def test_revert_commit_untrashes_photos_and_marks_original_reverted(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    client.post("/api/commits", json={"branch_id": branch_id, "action_type": "decide",
                                       "payload": {"photo_id": a.id, "decision": "reject"}})
    commit = client.post(f"/api/branches/{branch_id}/commit-rejects").json()

    # Now trashed.
    state = client.get(f"/api/branches/{branch_id}/state").json()
    assert state[str(a.id)] == "trash"

    r = client.post(f"/api/commits/{commit['id']}/revert")
    assert r.status_code == 200
    assert r.json()["reverted_commit_id"] == commit["id"]

    # After revert, photo falls back to its underlying reject decision.
    state_after = client.get(f"/api/branches/{branch_id}/state").json()
    assert state_after[str(a.id)] == "reject"

    # Listing now marks the original commit reverted.
    commits = client.get(f"/api/branches/{branch_id}/commits").json()
    assert commits[0]["is_active"] is False
    assert commits[0]["reverted_by"] is not None


def test_revert_404_for_unknown_commit(client):
    r = client.post("/api/commits/9999/revert")
    assert r.status_code == 404


def test_revert_400_when_target_is_not_a_trash_commit(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", 1)
    branch_id = client.post("/api/branches", json={"name": "main"}).json()["id"]
    decide = client.post("/api/commits", json={
        "branch_id": branch_id, "action_type": "decide",
        "payload": {"photo_id": a.id, "decision": "reject"},
    }).json()

    r = client.post(f"/api/commits/{decide['id']}/revert")
    assert r.status_code == 400


def test_regroup_allocates_fresh_id_when_no_photo_has_a_group(client, db_session):
    a = _seed_photo(db_session, "/a.jpg", None)
    b = _seed_photo(db_session, "/b.jpg", None)
    # Another photo with a group id so the allocator has a max to base off.
    _seed_photo(db_session, "/c.jpg", 4)

    r = client.post("/api/photos/regroup", json={"photo_ids": [a.id, b.id]})
    assert r.status_code == 200
    assert r.json()["group_id"] == 5
