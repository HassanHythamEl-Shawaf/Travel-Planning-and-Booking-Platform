# Spec: Image uploads (shared upload module)

**Requirements:** GEN-08. Used by BLG-10 (blog images), FLT-01 (airline logo), HTL-01 (hotel photos) and ITN-12 (activity images)
**Owner:** Hammad (Person 8)
**Authority:** the official requirements sheet wins over this spec.

## 1. Requirement (from the sheet)

| ID | Rule |
|---|---|
| GEN-08 | The system accepts image uploads in JPG or PNG format, up to 5 MB each, with up to 5 images per post, activity or hotel and 1 logo per airline, stored on the server and served by URL. Uploads outside these limits are rejected with an error. |

## 2. Decisions

| # | Decision |
|---|---|
| D1 | One `UploadsModule` (`src/uploads/`) exports `UploadsService` and one thin adapter per consumer. Shared limits are in `uploads.constants.ts`: `IMAGE_TYPES` (jpg, png), `MAX_IMAGE_BYTES` (5 MB), `MAX_IMAGES_PER_ITEM` (post 5, activity 5, hotel 5, airline 1). |
| D2 | The type is detected from the file's first bytes: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`. The client's mimetype and file name are ignored, and the stored content type is the detected one. Anything else gets a 400 "Only JPG or PNG images are allowed". |
| D3 | Per-item limits are enforced by the module that owns the item, with a conditional update on its own document, so parallel uploads can never go over the limit. Blog pushes only if `images.4` does not exist; activities and hotels do the same; an airline has a single `logoUrl` field. If the conditional update fails, the owner deletes the file it just uploaded and answers 400. This keeps the check atomic in one document, and replacing an airline logo needs no special case. |
| D4 | 5 MB is checked twice. `UploadsService.validate` checks the buffer length on every upload. Routes that use `ImageFileInterceptor` also set multer's `limits.fileSize`, so multer stops reading a file that is too big, and its "file too large" error (413 in Nest) becomes a 400 "Images can be at most 5 MB". A missing file and an empty file are also 400. |
| D5 | Files are stored under `UPLOAD_DIR` (default `backend/uploads/`, git-ignored), named `<random UUID>.jpg` or `.png`. The original file name is never used in the path. The file is written first (`wx`, never overwriting), then a record goes into the `uploads` collection (`ownerType`, `ownerId`, `uploaderId`, `fileName`, `mimeType`, `size`, `url`, `createdAt`). If saving the record fails, the file is deleted. |
| D6 | Files are served by `GET /api/uploads/:fileName`, a controller in the uploads module (not `main.ts`, so it also exists in the e2e tests). It is public. The name must match the stored-name pattern, be in `uploads` and exist on disk, otherwise 404. The response has the stored content type, `X-Content-Type-Options: nosniff` and a one-day cache. URL format: `/api/uploads/<uuid>.<jpg\|png>`, relative to the API host. |
| D7 | Adapters, all bound: `BLOG_IMAGE_STORE` → `BlogImageUploadAdapter`, `AIRLINE_LOGO_STORE` → `AirlineLogoUploadAdapter`, `HOTEL_PHOTO_STORE` → `HotelPhotoUploadAdapter`. The airline token was bound in the same commit as the logo endpoint, and a direct `logoUrl` is now always rejected with 400 (before, binding the token would have silently dropped it). The airline and hotel routes were agreed with Yahia and Seif, and are limited to the assigned provider moderator (`ProviderOwnershipGuard`). |
| D12 | Airline logo: `PUT /api/airlines/:id/logo` uploads or replaces it. The new URL is swapped in with one atomic update that returns the previous document, and the old file is deleted afterwards, so parallel replacements never leave an orphaned file or delete the current logo. `DELETE /api/airlines/:id/logo` clears it. |
| D13 | Hotel photos: `POST /api/hotels/:id/photos` pushes only if `photos.4` does not exist (5 per hotel). `DELETE /api/hotels/:id/photos/:fileName` pulls `/api/uploads/<fileName>` and deletes the file. `CreateHotelDto` still accepts `photos` as URL strings; that is Seif's, and is noted for him. |
| D14 | Blog's image route uses `ImageFileInterceptor` (agreed with Wael), so files over 5 MB stop loading early. |
| D8 | Delete is idempotent: an unknown id or a URL that is not ours does nothing. `deleteByUrl(url, owner)` only deletes a file whose record belongs to that owner, so a URL copied into another item (e.g. through `POST /api/hotels`, which accepts photo URL strings) can never delete someone else's file. Removing the file is best effort (a missing file is fine, other errors are logged). Owners delete files only after their database change is committed. |
| D9 | `copy(uploadId, owner)` makes a new file and record for another item. Cloned itineraries use it, so deleting the original never breaks the clone. It returns `null` if the original is gone. |
| D10 | Images of hidden or private content can still be fetched by anyone with the URL. The URLs contain a random UUID and are not listed anywhere, so they cannot be guessed. |
| D11 | No new dependencies: `crypto.randomUUID()`, `fs/promises` and multer (bundled with `@nestjs/platform-express`). |

## 3. Contract for teammates

| | |
|---|---|
| Upload | `UploadsService.upload(file, { type, id }, uploaderId?)`, or the module's adapter. `file` is multer's memory-storage file (`buffer` is required). |
| Returns | `{ id, url, fileName, mimeType, size }`. Blog's adapter returns `{ imageId, url }`; the airline and hotel adapters return the `url`. |
| Delete | `UploadsService.delete(id)` or `deleteByUrl(url)`. Adapters: `delete(imageId)` / `remove(url)`. |
| Errors | 400 with the messages in `UPLOAD_ERRORS` (missing, empty, over 5 MB, wrong type). |
| Per item | `MAX_IMAGES_PER_ITEM[type]`, enforced by the owner (D3). |
| Route helper | `@UseInterceptors(ImageFileInterceptor('file'))` gives the 5 MB multer limit and a 400 for too-large files. |

## 4. Endpoints

| Method | Path | Req | Who |
|---|---|---|---|
| GET | `/api/uploads/:fileName` | GEN-08 | anyone |
| POST | `/api/posts/:id/images` | BLG-10 | post author (Blog) |
| DELETE | `/api/posts/:id/images/:imageId` | BLG-10 | post author (Blog) |
| PUT | `/api/airlines/:id/logo` | FLT-01 | assigned airline moderator |
| DELETE | `/api/airlines/:id/logo` | FLT-01 | assigned airline moderator |
| POST | `/api/hotels/:id/photos` | HTL-01 | assigned hotel moderator |
| DELETE | `/api/hotels/:id/photos/:fileName` | HTL-01 | assigned hotel moderator |

Uploading is done through the owners' endpoints, not through the uploads module. Activity images (ITN-12) are added with the itineraries module.

## 5. Tests

- `src/uploads/image-file.spec.ts`: type detection from the first bytes.
- `src/uploads/uploads.service.spec.ts` (in-memory MongoDB, temporary folder): JPG/PNG accepted, exactly 5 MB accepted and 5 MB + 1 rejected, a renamed GIF rejected, random names, no file left behind on rejection or when the record fails, delete by id and by URL, idempotent delete, an independent copy, serving only stored files.
- `test/uploads.e2e-spec.ts` (HTTP): the multer limit answers 400 (not 413), files are served with the right content type, unknown or malformed names give 404, and 10 parallel uploads each get their own file and record.
- `test/blog.e2e-spec.ts`: a real upload, removal and file deletion through Blog, a file over 5 MB rejected with 400, and 8 parallel uploads to one post: exactly 5 succeed and the 3 extra files are deleted.
- `test/provider-images.e2e-spec.ts`: the airline moderator uploads, replaces (old file deleted, one upload record left) and removes the logo; bad files, a direct `logoUrl`, guests, users and other moderators are rejected. 8 parallel hotel photo uploads keep exactly 5; a 6th is rejected; removing a photo deletes its file; only the hotel's moderator may change photos.
- `src/airlines/airlines.service.spec.ts`: logo replace, remove, an unknown airline and the "airline deleted during upload" cleanup.
