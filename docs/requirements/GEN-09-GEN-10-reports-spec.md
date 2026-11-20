# Spec: Content Reports and Admin Moderation

**Requirements:** GEN-09, GEN-10 (plus GEN-07 audit entries and GEN-01 notifications, both already built)
**Owner:** Wael (Person 2)
**Authority:** the official requirements sheet wins over this spec. The sheet couldn't be read when this was written, so the rules below come from the project description (§6.6, §8.2, §8.10) and the team work split. If the GEN-09/GEN-10 rows differ, follow the sheet.

| ID | Rule (as known) |
|---|---|
| GEN-09 | Registered users report inappropriate content. Reportable: blog posts, comments, hotel reviews, itineraries. |
| GEN-10 | Admins review reports and may **dismiss** them, **hide** the content, or **delete** it. Hidden content is visible only to its author and admins. Important moderation actions are auditable. |

Endpoints from the project description: `GET /api/admin/reports`, `PATCH /api/admin/reports/:id`, `DELETE /api/admin/content/:type/:id`. §8.10 allows extra endpoints for content reporting.

---

## 1. Decisions (final, from the design review)

| # | Decision |
|---|---|
| D1 | Reportable `targetType`: `post`, `comment`, `review`, `itinerary`. Nothing else (no user profiles, no hotels). |
| D2 | Any logged-in, non-suspended account may report (`AuthGuard` already blocks suspended/deactivated accounts). Guests → 401. Reporting **your own** content → **403** `You cannot report your own content`. |
| D3 | Only content the reporter can currently see is reportable. Not found, a draft post, a private itinerary, hidden content, a comment whose parent post isn't visible, or content whose author is **deactivated** → **404** `Content not found` (never reveal that it exists). Content of **suspended** authors stays visible and reportable (ACC-16). |
| D4 | `reason` enum: `spam`, `harassment`, `inappropriate`, `misinformation`, `other`. `details`: optional string ≤500, trimmed; **required** (1–500) when `reason = other`. |
| D5 | One **open** report per user per item: partial unique index on `{ reporterId, targetType, targetId }` with `partialFilterExpression: { status: 'open' }`. Duplicate → **409** `You have already reported this content`. After resolution the user may report again. A race that hits E11000 → 409. |
| D6 | One user endpoint `POST /api/reports`, plus `GET /api/reports/mine`. No per-resource report routes. |
| D7 | Report status: `open` → `dismissed` \| `content_hidden` \| `content_deleted`. Stores `resolvedBy`, `resolvedAt`, `resolutionNote`. Terminal states never change again. |
| D8 | **Cascade:** resolving any report on an item resolves **all** open reports on that item with the same outcome. |
| D9 | `PATCH /api/admin/reports/:id` body `{ action: 'dismiss' \| 'hide', note? }`. Deleting goes through `DELETE /api/admin/content/:type/:id`, which also resolves the item's open reports as `content_deleted`. |
| D10 | Admins can moderate **without** a report: `PATCH /api/admin/content/:type/:id/hide` and `/unhide`, plus the DELETE. Hiding resolves open reports as `content_hidden`. Unhiding never reopens reports. |
| D11 | Each report stores a **snapshot** taken at report time (`title` if any, `excerpt` = first 200 chars of the text, `authorId`), so it stays readable after the content is deleted or edited. |
| D12 | Every admin moderation action runs in **one MongoDB transaction**: content change + report updates + audit entry. Notifications go out **after** commit (same pattern as ACC-13 D10). |
| D13 | Concurrency: the report being acted on is claimed with a conditional `updateOne({ _id, status: 'open' })`. If it matched 0 → **409** `Report is already resolved`. Content hide/unhide is conditional on the current `isHidden` value → **409** when already in that state. |
| D14 | Hidden means: visible only to the author and admins; for everyone else → 404, and excluded from search, counts and ratings. **Enforcement in read endpoints belongs to the content owner** (Blog: Wael, later; reviews: Yassin; itineraries: Hammad). This spec only sets the flag. |
| D15 | Hiding a post hides only the post. Its comments are not modified (they become unreachable through the hidden post; the Blog spec handles that). |
| D16 | Content access goes through a **`ModerationRegistry`** with one handler per type (§5). Owners register their own handler; until they do, a **raw-collection default handler** is used. Default handlers support find + hide/unhide for all four types, and delete for `post` and `comment` only. Delete on `review` / `itinerary` without an owner handler → **501** `Deleting this content type is not available yet`. |
| D17 | Collection and field names for all four types live in `teammate-contracts.ts` (§4). Posts and comments belong to Wael, so their names are decided here and the Blog spec must use them. |
| D18 | Notifications: the **content author** gets `CONTENT_HIDDEN`, `CONTENT_UNHIDDEN` or `CONTENT_DELETED`; **each distinct reporter** of the resolved reports gets `REPORT_RESOLVED` with `outcome: 'action_taken' \| 'no_violation'`. Never reveal other reporters or the admin's identity. No notification to the author on dismiss. |
| D19 | Audit actions (already in the enum): `REPORT_DISMISSED`, `CONTENT_HIDDEN`, `CONTENT_UNHIDDEN`, `CONTENT_DELETED`. `targetType`/`targetId` = **the content**, `details` = `{ reportIds, snapshot, note }`. Creating a report is **not** audited (the audit log covers admin actions only). |
| D20 | Reports are built **before** Blog. Blog later registers real post/comment handlers that replace the defaults. |
| D21 | No rate limiting on reports for Milestone 1. |
| D22 | Report `targetId` is stored as **ObjectId** (all four content types are created through the API). Invalid ObjectId → 400 before any DB call. |
| D23 | If the content was deleted by its owner after being reported: `dismiss` still works; `hide` → **404** `Content not found`; DELETE → 404. (The Blog spec will auto-close open reports when an author deletes their own post/comment.) |

## 2. Out of scope

- Blog schemas, services and endpoints (next spec). The default post/comment handlers work on raw collections only.
- Filtering `isHidden` out of review, itinerary, post or comment read endpoints (owners, per D14).
- Hotel average-rating recompute when a review is hidden or deleted (Yassin's handler does it when he registers one).
- Deleting images of deleted content (Hammad's upload module; Blog spec).
- Report reasons beyond the enum, report rate limiting, appeals, email notifications.

## 3. Branches

| PR | Branch | Base | Content |
|---|---|---|---|
| 4 | `feature/GEN-09-content-reports` | tip of `feature/ACC-13-ACC-17-admin-endpoints` | contracts additions, `ModerationRegistry` + default handlers, Report schema, `POST /api/reports`, `GET /api/reports/mine`, this spec file, tests |
| 5 | `feature/GEN-10-admin-moderation` | PR 4 branch | admin endpoints §7.3–7.6, new notification types, e2e test, README section "Reports & moderation" |

## 4. Teammate contracts — additions to `src/integrations/teammate-contracts.ts`

```ts
export const CONTENT_COLLECTIONS = {
  post: 'posts',            // Blog (Wael). Mongoose model Post
  comment: 'comments',      // Blog (Wael). Mongoose model Comment
  like: 'likes',            // Blog (Wael). Mongoose model Like; used only by the post delete cascade
  review: 'reviews',        // Yassin (Person 6). Mongoose model Review
  itinerary: 'itineraries', // Hammad (Person 8). Mongoose model Itinerary
} as const;

// Fields read / written by the default handlers (missing isHidden = false):
// posts:       _id, authorId (ObjectId), title (string), content (string),
//              status ('draft' | 'published'), isHidden (boolean)
// comments:    _id, postId (ObjectId), authorId (ObjectId), content (string), isHidden
// likes:       postId (ObjectId), userId (ObjectId)
// reviews:     _id, userId (ObjectId), hotelId (ObjectId), comment (string), isHidden
// itineraries: _id, ownerId (ObjectId), title (string), isPublic (boolean), isHidden
export const POST_STATUS = { DRAFT: 'draft', PUBLISHED: 'published' } as const;
```

If a teammate's schema already exists on `develop` with different names, use theirs and change only this file.

## 5. ModerationRegistry (`src/moderation/`)

```ts
export type ContentType = 'post' | 'comment' | 'review' | 'itinerary';

export interface ModeratableContent {
  id: string;
  type: ContentType;
  authorId: string;
  isHidden: boolean;
  /** true when a non-author, non-admin could see it right now (published / public, parent visible). Author status is checked by the registry, not here. */
  publiclyVisible: boolean;
  snapshot: { title?: string; excerpt: string }; // excerpt = first 200 chars
}

export interface ModerationHandler {
  find(id: string, session?: ClientSession): Promise<ModeratableContent | null>;
  /** Conditional: matches only if isHidden !== hidden. Returns false if not found or already in that state. */
  setHidden(id: string, hidden: boolean, session: ClientSession): Promise<boolean>;
  /** Optional. Returns false if not found. */
  delete?(id: string, session: ClientSession): Promise<boolean>;
}

@Injectable()
export class ModerationRegistry {
  register(type: ContentType, handler: ModerationHandler): void; // owner handler replaces the default
  get(type: ContentType): ModerationHandler;
  /** find() + author-status check: publiclyVisible && author not deactivated */
  findVisible(type: ContentType, id: string): Promise<ModeratableContent | null>;
}
```

- Default handlers use `@InjectConnection()` + `connection.collection(CONTENT_COLLECTIONS[type])`. A missing collection returns `null` / `false` and never throws.
- `publiclyVisible` per type: **post** = `status === 'published' && !isHidden`; **comment** = `!isHidden` and its parent post exists, is published, not hidden, and the post's author isn't deactivated; **review** = `!isHidden`; **itinerary** = `isPublic && !isHidden`.
- `findVisible` additionally reads the author from `users` and returns `null` if the author's status is `deactivated`.
- Default delete: **post** deletes the post, its comments and its likes (same session); **comment** deletes the comment. Review/itinerary defaults have no `delete`.
- `ModerationModule` exports `ModerationRegistry` for teammates.

## 6. Schema

**Report** (`timestamps: true`, collection `reports`)
- `reporterId`: ObjectId ref User, required
- `targetType`: enum `ContentType`, required
- `targetId`: ObjectId, required
- `reason`: enum `ReportReason`, required
- `details`: string | null, default null
- `status`: enum `ReportStatus` (`open`, `dismissed`, `content_hidden`, `content_deleted`), default `open`
- `snapshot`: `{ title?: string; excerpt: string; authorId: ObjectId }`, required
- `resolvedBy`: ObjectId ref User | null; `resolvedAt`: Date | null; `resolutionNote`: string | null (≤500)
- Indexes: partial unique `{ reporterId: 1, targetType: 1, targetId: 1 }` where `status: 'open'` (D5); `{ targetType: 1, targetId: 1, status: 1 }`; `{ status: 1, createdAt: -1 }`; `{ reporterId: 1, createdAt: -1 }`

## 7. Endpoints

Conventions: `@ApiTags`, `@ApiOperation` with the requirement ID, body DTOs, every listed response as `@Api…Response`, ObjectId params validated (400), `type` path params via `ParseEnumPipe`, lists via `getPagination()` (page size 10) returning `Paginated<T>`. Swagger tags: `Reports` (user side) and `Admin – Moderation`.

### 7.1 `POST /api/reports` — GEN-09 (any logged-in account)
Body: `targetType` (ContentType), `targetId` (MongoId), `reason` (ReportReason), `details?`.
1. `details` rule (D4) → 400.
2. `registry.findVisible(...)` → null → **404** (D3).
3. `authorId === caller` → **403** (D2).
4. Insert with the snapshot. E11000 → **409** (D5).
5. **201** `{ id, targetType, targetId, reason, status: 'open', createdAt }`.
Responses: 201, 400, 401, 403, 404, 409.

### 7.2 `GET /api/reports/mine` — GEN-09
Query: `page`, `status?`. Newest first. Item: `{ id, targetType, targetId, reason, details, status, snapshot: { title, excerpt }, createdAt, resolvedAt }`. No `resolvedBy`, no `resolutionNote`.

### 7.3 `GET /api/admin/reports` — GEN-09, GEN-10 (admin)
Query: `page`, `status?` (default `open`; accept `all`), `targetType?`, `reason?`, `targetId?`, `from?`, `to?` (on `createdAt`; `from > to` → 400). Sort `createdAt` desc, then `_id` desc.
Item: `{ id, targetType, targetId, reason, details, status, reporter: { id, name, email }, snapshot: { title, excerpt, authorId, authorName }, openReportsOnTarget, createdAt, resolvedBy, resolvedAt, resolutionNote }`.
Reporter and author names come from **one** `$in` query per page; `openReportsOnTarget` from **one** grouped count per page. A deleted user shows as `"Deleted user"`.

### 7.4 `PATCH /api/admin/reports/:id` — GEN-10 (admin)
Body: `action` (`dismiss` | `hide`), `note?` (≤500).
- Report not found → 404. Not `open` → 409.
- **dismiss**, in a transaction: claim this report (D13); mark every other open report on the same target `dismissed` (D8); audit `REPORT_DISMISSED`. After commit: `REPORT_RESOLVED` (`no_violation`) to each distinct reporter.
- **hide**, in a transaction: `handler.find` → null → 404 (D23); claim the report; `setHidden(true)` (if it's already hidden, continue without changing it and set `details.alreadyHidden = true`); mark all open reports on the target `content_hidden`; audit `CONTENT_HIDDEN`. After commit: `CONTENT_HIDDEN` to the author (skip if it was already hidden) and `REPORT_RESOLVED` (`action_taken`) to each distinct reporter.
- **200** `{ id, status, resolvedReports }` (count, including this one).
Responses: 200, 400, 401, 403, 404, 409.

### 7.5 `PATCH /api/admin/content/:type/:id/hide` and `/unhide` — GEN-10 (admin)
Body (optional): `note` (≤500).
- Content not found → 404. Already in that state → 409 `Content is already hidden` / `Content is not hidden`.
- Hide, in a transaction: `setHidden(true)`, resolve open reports on it as `content_hidden`, audit `CONTENT_HIDDEN`. After commit: notify the author, and `REPORT_RESOLVED` (`action_taken`) to the resolved reports' reporters.
- Unhide, in a transaction: `setHidden(false)`, audit `CONTENT_UNHIDDEN`. Reports untouched. After commit: `CONTENT_UNHIDDEN` to the author.
- **200** `{ targetType, targetId, isHidden, resolvedReports }`.

### 7.6 `DELETE /api/admin/content/:type/:id` — GEN-10 (admin)
Query: `note?` (≤500; a query param because Swagger handles DELETE bodies badly).
- Handler has no `delete` → **501** (D16). Not found → 404.
- In a transaction: read the snapshot, `handler.delete`, resolve open reports as `content_deleted`, audit `CONTENT_DELETED` `{ reportIds, snapshot, note }`. After commit: `CONTENT_DELETED` to the author (payload includes the snapshot title/excerpt), `REPORT_RESOLVED` (`action_taken`) to reporters.
- **200** `{ targetType, targetId, deleted: true, resolvedReports }`.
Responses: 200, 400, 401, 403, 404, 501.

## 8. Notifications

- Add `REPORT_RESOLVED` and `CONTENT_UNHIDDEN` to `NotificationType`, with templates. `REPORT_RESOLVED` text depends on `payload.outcome`; it must not name the admin or other reporters.
- `CONTENT_HIDDEN` / `CONTENT_DELETED` / `CONTENT_UNHIDDEN` templates mention the content type and snapshot title (fallback to the excerpt's first 50 chars).
- Use `sendMany` for reporters, deduplicated, excluding the author if they somehow appear.

## 9. Tests

Unit tests with mocked models, connection and registry:
- **Default handlers:** `publiclyVisible` for each type (draft post, private itinerary, hidden, comment under hidden/draft post), conditional `setHidden` returning false on same state, post delete cascades to comments and likes, missing collection → null without throwing.
- **Registry:** an owner handler replaces the default; `findVisible` returns null for a deactivated author and not for a suspended one.
- **ReportsService (user):** each 400/403/404/409 in §7.1, `other` without details, snapshot excerpt capped at 200, E11000 → 409, re-reporting after resolution allowed.
- **ModerationService (admin):** dismiss/hide cascade to all open reports on the target and not to other targets; already-resolved → 409; hide on deleted content → 404; already-hidden path; unhide doesn't reopen reports; DELETE 501 for review/itinerary without a handler; audit details contain `reportIds` and snapshot; notifications sent only after commit and deduplicated; transaction abort leaves no partial state.
- **Admin list:** filters, default `status=open`, `from > to` → 400, `openReportsOnTarget` counts, "Deleted user".

E2E (`test/reports.e2e-spec.ts`, `MongoMemoryReplSet`, never Atlas): users and the seeded admin; raw-insert a published post, a comment, a review and a public itinerary authored by user A. Covers reporting, duplicates, own content, drafts, dismiss/hide cascades and notifications, re-reporting after resolution, unhide, delete, 501 for reviews, two parallel `PATCH /api/admin/reports/:id` (exactly one 200, one 409) and the audit-log action types.
