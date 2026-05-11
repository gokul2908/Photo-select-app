import os
import hashlib
import threading
from datetime import datetime
import exifread
from PIL import Image
from sqlalchemy.orm import Session
from database import SessionLocal
import models

THUMBNAIL_DIR = ".photocull/thumbnails"
THUMBNAIL_SIZES = {"strip": 256, "main": 1600}

def parse_exif_date(tags):
    for key in ['EXIF DateTimeOriginal', 'Image DateTime', 'EXIF DateTimeDigitized']:
        if key in tags:
            date_str = str(tags[key])
            try:
                # Format is usually 'YYYY:MM:DD HH:MM:SS'
                dt = datetime.strptime(date_str, '%Y:%m:%d %H:%M:%S')
                return dt.timestamp()
            except ValueError:
                pass
    return 0.0

def process_directory(directory_path: str):
    db = SessionLocal()
    try:
        photos = []
        for root, _, files in os.walk(directory_path):
            if ".photocull" in root:
                continue
            for file in files:
                if file.lower().endswith((".jpg", ".jpeg")):
                    absolute_path = os.path.abspath(os.path.join(root, file))
                    photos.append(absolute_path)
        
        processed_photos = []
        for path in photos:
            # Check if exists
            existing = db.query(models.Photo).filter(models.Photo.absolute_path == path).first()
            if existing:
                continue

            # Hash
            hasher = hashlib.sha256()
            try:
                with open(path, 'rb') as f:
                    hasher.update(f.read())
            except Exception as e:
                print(f"Could not read {path}: {e}")
                continue
            content_hash = hasher.hexdigest()
                
            # EXIF
            timestamp = 0.0
            try:
                with open(path, 'rb') as f:
                    tags = exifread.process_file(f, details=False)
                    timestamp = parse_exif_date(tags)
            except Exception as e:
                print(f"Could not read EXIF for {path}: {e}")
                
            # Thumbnail
            try:
                img = Image.open(path)
                # Fix orientation based on EXIF if needed (omitted for now for simplicity)
                width, height = img.size
                
                thumb_base_dir = os.path.join(directory_path, THUMBNAIL_DIR)
                os.makedirs(thumb_base_dir, exist_ok=True)
                
                for name, size in THUMBNAIL_SIZES.items():
                    thumb_path = os.path.join(thumb_base_dir, f"{content_hash}_{name}.jpg")
                    if not os.path.exists(thumb_path):
                        img_copy = img.copy()
                        img_copy.thumbnail((size, size))
                        img_copy.save(thumb_path, "JPEG")
            except Exception as e:
                print(f"Failed to process image {path}: {e}")
                continue

            photo = models.Photo(
                absolute_path=path,
                content_hash=content_hash,
                timestamp=timestamp,
                width=width,
                height=height,
                group_id=None
            )
            processed_photos.append(photo)
        
        if not processed_photos:
            return

        # Sorting and grouping
        processed_photos.sort(key=lambda x: x.timestamp or 0.0)
        
        current_group_id = 1
        max_group = db.query(models.Photo).order_by(models.Photo.group_id.desc()).first()
        if max_group and max_group.group_id:
            current_group_id = max_group.group_id + 1
            
        for i in range(len(processed_photos)):
            if i > 0:
                time_diff = abs((processed_photos[i].timestamp or 0) - (processed_photos[i-1].timestamp or 0))
                if time_diff > 3.0: # 3 seconds burst threshold
                    current_group_id += 1
            processed_photos[i].group_id = current_group_id
            db.add(processed_photos[i])
        
        db.commit()
        print(f"Successfully imported {len(processed_photos)} photos.")

    except Exception as e:
        print(f"Error indexing: {e}")
        db.rollback()
    finally:
        db.close()

def start_import(directory_path: str):
    thread = threading.Thread(target=process_directory, args=(directory_path,))
    thread.start()
