# Spec: Blog (posts, tags, search, comments, likes, images, author pages)

**Requirements:** BLG-01 to BLG-12 (BLG-13 is optional and out of scope), GEN-08 (images through the shared upload module), GEN-09 / GEN-10 (moderation handlers)
**Owner:** Wael (Person 2)
**Authority:** the official requirements sheet wins over this spec. The sheet was read on 2026-11-05; differences are listed in §1.

## 1. Requirements (from the sheet)

| ID | Rule |
|---|---|
| BLG-01 | A registered user creates a post with a required title and body, optional tags and images, saved as Draft or Published. Published posts appear in the author's blog and in search. |
| BLG-02 | Guests and users browse a paginated list of published posts, filterable by tag, and open a post page (title, author, date, body, tags, images, like count, comments). Liking, commenting and reporting require login. |
| BLG-03 | A user lists their own posts, drafts included, with title, status, date, like count and comment count. |
| BLG-04 | An author edits and deletes their own posts. |
| BLG-05 | A user comments on a published post (non-empty, **max 500 characters**), shown in chronological order. |
| BLG-06 | A user likes a post once and removes the like; the like count is shown. |
| BLG-07 | A user edits and deletes their own comments. |
| BLG-08 | Up to 5 tags (max 30 characters each), editable later; searchable and clickable to list matching posts. |
| BLG-09 | Search published posts by keyword in **title, tags or author name**; show title, author, date and excerpt, or "no results". Ordered by likes + comments descending, newest first on ties. |
| BLG-10 | Attach images under GEN-08 (JPG/PNG, 5 MB each, max 5 per post) and remove them. |
| BLG-12 | Public author page: name, join date, published posts and public itineraries. |

**Differences from the design review, where the sheet wins:**
- Comments are limited to **500** characters (the review said 1,000).
- Search matches **title, tags and author name** (the review said title, content and tags). Content is not searched.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Real Mongoose models `Post`, `Comment` and `Like`, using the collection and field names in `teammate-contracts.ts` (`posts`, `comments`, `likes`; `authorId`, `title`, `content`, `status`, `isHidden`, `postId`, `userId`). |
| D2 | `title` is 3–150 characters (trimmed). `content` is 1–20,000 characters, must contain a non-space character, and is stored as written. |
| D3 | Status moves both ways (`draft ↔ published`). `publishedAt` is set on the first publish and never changes. |
| D4 | Who can see a post: a **draft** only its author (admins and everyone else get 404); a **hidden** post its author and admins; a post whose **author is deactivated** admins only; a post whose **author is suspended** everyone, as normal (ACC-16). Anyone who can't see a post gets 404. |
| D5 | `GET /posts/mine`: both statuses, an optional `status` filter, hidden posts included with `isHidden: true`, sorted by `updatedAt` descending. |
| D6 | An author's delete is a hard delete in one transaction: the post, its comments and likes, plus open reports on the post or its comments, which are closed as `content_deleted` with `resolvedBy: null` and `resolutionNote: 'Deleted by author'`. Reporters are not notified. Image files are deleted after the commit (best effort). A comment author deleting their own comment closes that comment's reports the same way. |
| D7 | `likeCount` and `commentCount` are stored on the post and updated with `$inc` in the same transaction as the like or comment write. `commentCount` counts non-hidden comments only, and is never decremented below 0. |
| D8 | Order: `likeCount + commentCount` descending, then `publishedAt` descending, then `_id` descending. This applies to `GET /posts`, `GET /tags/:tag/posts` and the author page. |
| D9 | `q` (≤100 characters) is escaped and matched case-insensitively against title, tags and author name. Optional `tag` and `authorId` filters. No `$text` index. |
| D10 | Tags are an embedded `string[]` with no Tag collection. Each tag is trimmed, lowercased, 1–30 characters, matching `^[a-z0-9-]+$`, and the list is deduplicated. More than 5 after deduplication → 400. |
| D11 | Comments are flat, 1–500 characters (trimmed), and can only be added to a published, visible post (404 otherwise). Only the comment's author can edit (sets `editedAt`) or delete it, including after the post is hidden or set back to draft. The post's author cannot delete other people's comments. |
| D12 | Comments are listed oldest first. Hidden comments are shown only to their author and admins. A comment by a deactivated user stays, with `author: { id: null, name: 'Deleted user' }`. |
| D13 | Likes have a unique `{ postId, userId }` index. `POST` and `DELETE /like` are idempotent and return `200 { liked, likeCount }`. Authors may like their own posts. Likes work only on published, visible posts. An E11000 from a race counts as "already liked". |
| D14 | Comments and likes send no notifications. |
| D15 | Images go through the shared upload module. The first image is the cover. Until that module is bound to `BLOG_IMAGE_STORE`, the image endpoints answer 501. |
| D16 | `GET /authors/:id`: `{ id, name, joinedAt, publishedPostCount, posts, publicItineraries (up to 10) }`. `User` has no bio or avatar fields yet. Unknown, deactivated, admin or moderator accounts → 404. Suspended authors stay visible. |
| D17 | Public GETs use `OptionalAuthGuard` (in `src/blog/`). It mirrors `AuthGuard`'s checks, but any failure makes the request a guest request, never a 401. |
| D18 | Blog registers real `post` and `comment` handlers in the `ModerationRegistry`. |
| D19 | BLG-13 is out of scope. |
| D20 | Admins moderate only through the GEN-10 endpoints, but can read hidden posts and comments through the normal GETs. |
| D21 | Every list uses `getPagination()` (page size 10) and returns `Paginated<T>`. |

**Assumption:** only `user` accounts write posts, comments and likes (the sheet's actor is "Registered User"). Admin and moderator accounts get 403. This matches D16, which excludes them from author pages.

## 3. Endpoints

| Method | Path | Req | Auth |
|---|---|---|---|
| POST | `/api/posts` | BLG-01, BLG-08 | user |
| GET | `/api/posts` | BLG-02, BLG-09 | optional |
| GET | `/api/posts/mine` | BLG-03 | logged in |
| GET | `/api/posts/:id` | BLG-02 | optional |
| PATCH | `/api/posts/:id` | BLG-04, BLG-08 | owner |
| DELETE | `/api/posts/:id` | BLG-04 | owner |
| GET | `/api/posts/:id/comments` | BLG-05 | optional |
| POST | `/api/posts/:id/comments` | BLG-05 | user |
| PATCH | `/api/comments/:id` | BLG-07 | owner |
| DELETE | `/api/comments/:id` | BLG-07 | owner |
| POST | `/api/posts/:id/like` | BLG-06 | user |
| DELETE | `/api/posts/:id/like` | BLG-06 | user |
| POST | `/api/posts/:id/images` | BLG-10, GEN-08 | owner |
| DELETE | `/api/posts/:id/images/:imageId` | BLG-10 | owner |
| GET | `/api/tags/:tag/posts` | BLG-08 | optional |
| GET | `/api/authors/:id` | BLG-12 | optional |

For owner-only actions, a non-owner who can see the item gets 403; anyone else gets 404.

## 4. Out of scope

BLG-13, comment and like notifications, a Tag collection, popular tags, slugs, rate limiting, nested replies.
