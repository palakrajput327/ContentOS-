# Workflow: Bulk Post Deletion (`bulk-post-deletion.md`)

This workflow documents the lifecycle of bulk post deletion in ContentOS, explaining how posts are safely removed from external social platforms and local database tables without data corruption or accidental deletions.

---

## 1. Interaction Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as Workspace Admin
    participant UI as Content Library / BulkDeleteModal
    participant Ctrl as ContentController
    participant DeletionSvc as PostDeletionService
    participant SocialSvc as SocialPlatformDeleteService
    participant SocialNet as Social Platforms (Telegram, LinkedIn, Meta, etc.)
    participant DB as PostgreSQL Database

    User->>UI: Selects posts or clicks "Bulk Delete"
    UI->>Ctrl: POST /api/v1/content/bulk-delete/preview (scope, channel, dates, postIds)
    Ctrl->>DeletionSvc: getDeletionPreview(opts)
    DeletionSvc->>DB: Query scheduled_posts + social_accounts + content
    DB-->>DeletionSvc: Matching records & providerPostIds
    DeletionSvc-->>UI: Preview summary (totalMatching, items, channelsSummary)

    User->>UI: Reviews preview list & checks "I understand this action is permanent"
    User->>UI: Clicks "Delete N Posts"
    UI->>Ctrl: POST /api/v1/content/bulk-delete/execute (confirm: true, deleteFromPlatform: true)
    Ctrl->>DeletionSvc: executeBulkDeletion(opts)

    loop For each matching post
        alt Post is PUBLISHED with provider_post_id & deleteFromPlatform=true
            DeletionSvc->>SocialSvc: deleteFromPlatform(channel, providerPostId, ciphertext, account)
            SocialSvc->>SocialNet: Call live DELETE API
            SocialNet-->>SocialSvc: Success (200 / 204 / 404 already deleted)
        end

        alt Platform deletion succeeded or post was not published
            DeletionSvc->>DB: DELETE FROM scheduled_posts WHERE id = post.id
            DeletionSvc->>DB: DELETE FROM published_posts WHERE scheduled_post_id = post.id
            DeletionSvc->>DB: Clean up unreferenced content & reset visual concept to PENDING
        else Platform deletion failed (API error / token expired)
            DeletionSvc->>DB: Preserve local record & update scheduled_posts.error_code
            DeletionSvc-->>DeletionSvc: Record failure in audit log
        end
    end

    DeletionSvc-->>UI: Execution summary (databaseDeleted, platformDeleted, platformFailed, items)
    UI-->>User: Displays completed report card & refreshes Library query cache
```

---

## 2. Trigger Points

The user can initiate bulk deletion from two distinct locations in the application:
1. **Header "Bulk Delete" Button:** Located in the top action bar of `/app/library`. Clicking opens the modal pre-configured in `all` or `today` scope.
2. **Floating Action Bar ("Delete Selected N"):** When a user checks one or more post checkboxes in the library table, a floating action bar appears with a red **Delete Selected (N)** button. Clicking opens the modal pre-configured with `scope = 'selected_ids'` and the exact list of selected IDs.

---

## 3. Supported Scopes & Filters

* **Scopes:**
  * `all`: Matches every post belonging to the current workspace.
  * `today`: Filters posts where `scheduled_at` or `created_at` falls on today's local date (using `timezoneOffsetMinutes`).
  * `custom_range`: Filters posts between `startDate` and `endDate`.
  * `selected_ids`: Filters strictly to the provided array of `postIds`.
* **Channel Filter:** `all` or a specific channel: `linkedin`, `telegram`, `facebook`, `instagram`, `twitter`, `youtube`.
* **Status Filter:** `all`, `published`, `scheduled` (enqueued/scheduled), or `failed`.
* **Platform Deletion Toggle:** "Also delete from live social platforms" (defaults to `true`).

---

## 4. Live External Social Platform Deletion

When a post is already live (`status = 'PUBLISHED'`) and has a valid `provider_post_id`, `SocialPlatformDeleteService` invokes the respective platform's live API:

| Platform | Endpoint / Method | Success Criteria |
|---|---|---|
| **Telegram** | `POST https://api.telegram.org/bot<token>/deleteMessage` (`{ chat_id, message_id }`) | `result.ok === true` or `"message to delete not found"` |
| **LinkedIn** | `DELETE https://api.linkedin.com/v2/shares/{shareId}` or `/ugcPosts/` or `/rest/posts/` | `HTTP 204`, `200`, or `404` (already removed) |
| **Facebook** | `DELETE https://graph.facebook.com/v22.0/{postId}?access_token={token}` | `HTTP 200` with `{ "success": true }` |
| **Instagram** | `DELETE https://graph.facebook.com/v22.0/{mediaId}?access_token={token}` | `HTTP 200` with `{ "success": true }` |
| **Twitter/X** | `DELETE https://api.twitter.com/2/tweets/{tweetId}` | `HTTP 200` with `{ "data": { "deleted": true } }` |
| **YouTube** | `DELETE https://www.googleapis.com/youtube/v3/videos?id={videoId}` | `HTTP 204` or `404` |

---

## 5. Safety Invariant: Partial Failures

> [!IMPORTANT]
> **Strict Safety Invariant:** If an external platform deletion returns an error (e.g., token revoked, rate limit reached, network timeout), **the local database record is NEVER deleted**.
>
> 1. The local record is retained with status `FAILED` and an error log.
> 2. The item is marked as `status: "FAILED"` in the execution response.
> 3. The user is informed via the results card, preventing desynchronization between ContentOS and social media feeds.

