import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Calendar,
  Layers,
  RefreshCw,
  Clock,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { ModalFrame, Button, PlatformIcon, StatusBadge } from "./ui";
import { request } from "../lib/api";

export interface BulkDeletePostsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  preselectedPostIds?: string[];
  initialScope?: "all" | "today" | "custom_range" | "selected_ids";
  initialChannel?: string;
}

interface PreviewItem {
  id: string;
  contentId: string | null;
  title: string;
  snippet: string;
  platform: string;
  accountName: string;
  state: string;
  providerPostId: string | null;
  executeAt: string | null;
  createdAt: string;
  canDeleteFromPlatform: boolean;
}

interface DeletionLogItem {
  id: string;
  title: string;
  platform: string;
  status: "DELETED" | "FAILED" | "SKIPPED";
  platformDeleted: boolean;
  message: string;
}

interface PreviewResponse {
  totalMatching: number;
  items: PreviewItem[];
  breakdownByChannel: Record<string, number>;
  breakdownByStatus: Record<string, number>;
  canDeletePlatformCount: number;
}

interface ExecutionResponse {
  success: boolean;
  totalRequested: number;
  deletedFromPlatform: number;
  deletedFromDatabase: number;
  failed: number;
  skipped: number;
  logs: DeletionLogItem[];
}

export function BulkDeletePostsModal({
  open,
  onClose,
  onSuccess,
  preselectedPostIds = [],
  initialScope = "all",
  initialChannel = "all",
}: BulkDeletePostsModalProps) {
  const isPreselected = preselectedPostIds.length > 0;
  const isSingle = preselectedPostIds.length === 1;

  // Form Filters State
  const [scope, setScope] = useState<"all" | "today" | "custom_range" | "selected_ids">(
    isPreselected ? "selected_ids" : initialScope
  );
  const [channel, setChannel] = useState<string>(initialChannel);
  const [stateFilter, setStateFilter] = useState<string>("ALL");
  const [startDate, setStartDate] = useState<string>(
    new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [deleteFromPlatform, setDeleteFromPlatform] = useState<boolean>(true);

  // Selected sub-items within preview
  const [selectedInPreview, setSelectedInPreview] = useState<string[]>([]);

  // Preview & Execution State
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Confirmation & Execution
  const [confirmed, setConfirmed] = useState<boolean>(isSingle);
  const [executing, setExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResponse | null>(null);

  // Reset or initialize when modal opens
  useEffect(() => {
    if (open) {
      if (preselectedPostIds.length > 0) {
        setScope("selected_ids");
        setConfirmed(preselectedPostIds.length === 1);
      } else {
        setScope(initialScope);
        setConfirmed(false);
      }
      setChannel(initialChannel);
      setExecutionResult(null);
    }
  }, [open, preselectedPostIds, initialScope, initialChannel]);

  const previewRequest = useRef(0);

  // Fetch Preview from API
  const fetchPreview = useCallback(async () => {
    if (!open) return;
    const requestId = ++previewRequest.current;
    setSelectedInPreview([]);
    setConfirmed(isSingle);
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const payload: Record<string, any> = {
        scope,
        channel: channel.toLowerCase(),
        state: stateFilter,
      };

      if (scope === "custom_range") {
        payload.startDate = startDate;
        payload.endDate = endDate;
      }

      if (scope === "selected_ids") {
        payload.postIds = preselectedPostIds;
      }

      const res = await request<PreviewResponse>("/content/bulk-delete/preview", "POST", payload);
      if (requestId !== previewRequest.current) return;
      setPreviewData(res);
      // Pre-select all matching items
      setSelectedInPreview((res?.items || []).map((i) => i.id));
    } catch (err: any) {
      if (requestId !== previewRequest.current) return;
      console.error("[BulkDeleteModal] Preview error:", err);
      setPreviewError(err?.message || "Failed to load matching posts.");
      setPreviewData(null);
    } finally {
      if (requestId === previewRequest.current) setLoadingPreview(false);
    }
  }, [open, scope, channel, stateFilter, startDate, endDate, preselectedPostIds]);

  useEffect(() => {
    if (open && !executionResult) {
      fetchPreview();
    }
    return () => { previewRequest.current++; };
  }, [open, fetchPreview, executionResult]);

  // Handle Select All / Deselect All in Preview Table
  const handleToggleSelectAll = () => {
    if (!previewData || !previewData.items) return;
    if (selectedInPreview.length === previewData.items.length) {
      setSelectedInPreview([]);
    } else {
      setSelectedInPreview(previewData.items.map((i) => i.id));
    }
  };

  const handleToggleItem = (id: string) => {
    setSelectedInPreview((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Execute Bulk Deletion
  const handleExecuteDelete = async () => {
    if (!confirmed && !isSingle) {
      toast.error("Please confirm the deletion warning before proceeding.");
      return;
    }

    const targetPostIds = selectedInPreview.length > 0
      ? selectedInPreview
      : (isPreselected ? preselectedPostIds : []);

    if (targetPostIds.length === 0) {
      toast.error("No posts selected to delete.");
      return;
    }

    setExecuting(true);
    try {
      const payload: Record<string, any> = {
        scope: "selected_ids",
        postIds: targetPostIds,
        deleteFromPlatform,
        confirm: true,
      };

      const res = await request<ExecutionResponse>("/content/bulk-delete/execute", "POST", payload);

      if (res.failed === 0 && res.skipped === 0) {
        toast.success(
          isSingle
            ? "Post deleted successfully!"
            : `Successfully deleted ${res.deletedFromDatabase} post${res.deletedFromDatabase !== 1 ? "s" : ""}!`
        );
        if (onSuccess) {
          onSuccess();
        }
        onClose();
        return;
      }

      setExecutionResult(res);
      toast.warning(
        `Deleted ${res.deletedFromDatabase} posts (${res.failed} failed, ${res.skipped} skipped).`
      );

      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error("[BulkDeleteModal] Execution error:", err);
      toast.error(err?.message || "Failed to delete posts.");
    } finally {
      setExecuting(false);
    }
  };

  const singleItem: PreviewItem | null = (isSingle && previewData?.items?.[0]) ? previewData.items[0] : null;
  const hasLivePlatform = Boolean(singleItem && (singleItem.canDeleteFromPlatform || singleItem.state === "PUBLISHED"));

  return (
    <ModalFrame
      open={open}
      onClose={executing ? () => {} : onClose}
      title={isSingle ? "Delete Post" : isPreselected ? `Delete ${preselectedPostIds.length} Selected Posts` : "Bulk Delete Posts"}
      className="bulk-delete-dialog"
    >
      <div
        className="panel modal-card"
        style={{
          maxWidth: isSingle ? "480px" : "680px",
          width: "100%",
          padding: "24px 26px",
          borderRadius: "18px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg), 0 20px 50px rgba(0, 0, 0, 0.25)",
          color: "var(--ink)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "12px",
              background: "rgba(239, 68, 68, 0.12)",
              color: "var(--danger, #ef4444)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Trash2 size={22} />
          </div>
          <div>
            <h2 style={{ margin: "0 0 4px 0", fontSize: "1.2rem", fontWeight: 700, color: "var(--ink)" }}>
              {isSingle ? "Delete Post" : isPreselected ? `Delete ${preselectedPostIds.length} Selected Posts` : "Bulk Post Deletion"}
            </h2>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
              {isSingle
                ? "Permanently remove this post from your library."
                : isPreselected
                  ? `Permanently remove ${preselectedPostIds.length} selected posts from your library.`
                  : "Safely delete multiple scheduled or published posts from your workspace and social channels."}
            </p>
          </div>
        </div>

        {/* View 1: Execution Completed Summary & Logs */}
        {executionResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                padding: "16px 20px",
                borderRadius: "12px",
                background:
                  executionResult.failed === 0
                    ? "rgba(16, 185, 129, 0.1)"
                    : "rgba(245, 158, 11, 0.1)",
                border:
                  executionResult.failed === 0
                    ? "1px solid rgba(16, 185, 129, 0.3)"
                    : "1px solid rgba(245, 158, 11, 0.3)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                {executionResult.failed === 0 ? (
                  <CheckCircle2 size={22} style={{ color: "var(--success, #10b981)" }} />
                ) : (
                  <AlertTriangle size={22} style={{ color: "var(--warning, #f59e0b)" }} />
                )}
                <strong style={{ fontSize: "1rem", color: "var(--ink)" }}>
                  Deletion Finished: {executionResult.deletedFromDatabase} Posts Cleared
                </strong>
              </div>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "0.85rem", color: "var(--ink)" }}>
                <span>
                  Social Platforms Cleared: <strong>{executionResult.deletedFromPlatform}</strong>
                </span>
                <span>
                  Database Records Removed: <strong>{executionResult.deletedFromDatabase}</strong>
                </span>
                {executionResult.failed > 0 && (
                  <span style={{ color: "var(--danger, #ef4444)" }}>
                    Failed / Preserved: <strong>{executionResult.failed}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Itemized Deletion Logs */}
            <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", padding: "4px 8px", display: "block" }}>
                Execution Audit Log
              </span>
              {executionResult.logs.map((log, i) => (
                <div
                  key={log.id + i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderBottom: i < executionResult.logs.length - 1 ? "1px solid var(--border)" : "none",
                    fontSize: "0.83rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {log.status === "DELETED" ? (
                      <CheckCircle2 size={16} style={{ color: "var(--success, #10b981)", flexShrink: 0 }} />
                    ) : (
                      <XCircle size={16} style={{ color: "var(--danger, #ef4444)", flexShrink: 0 }} />
                    )}
                    <div>
                      <strong style={{ display: "block", color: "var(--ink)" }}>{log.title}</strong>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{log.message}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "10px", background: "var(--surface2)", color: "var(--ink)", textTransform: "capitalize" }}>
                    {log.platform}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  if (onSuccess) onSuccess();
                }}
              >
                Close & Return
              </Button>
            </div>
          </div>
        ) : isSingle ? (
          /* View 2A: Dedicated Clean Single Post Delete View */
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {loadingPreview ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
                <RefreshCw size={18} className="spin" style={{ display: "inline-block", marginRight: "8px" }} />
                Loading post details...
              </div>
            ) : previewError ? (
              <div style={{ padding: "12px 14px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", fontSize: "0.85rem" }}>
                {previewError}
              </div>
            ) : (
              <>
                {/* Single Post Preview Card */}
                {singleItem && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "14px 16px",
                      borderRadius: "12px",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <PlatformIcon platform={singleItem.platform} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong
                        style={{
                          display: "block",
                          fontSize: "0.95rem",
                          color: "var(--ink)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {singleItem.title || "Untitled Post"}
                      </strong>
                      {singleItem.snippet && (
                        <span
                          style={{
                            display: "block",
                            fontSize: "0.8rem",
                            color: "var(--muted)",
                            marginTop: "3px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {singleItem.snippet}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <StatusBadge status={singleItem.state} />
                    </div>
                  </div>
                )}

                {/* Only show social platform toggle if post was published to a live platform */}
                {hasLivePlatform && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      background: "rgba(99, 102, 241, 0.08)",
                      border: "1px solid rgba(99, 102, 241, 0.25)",
                    }}
                  >
                    <input
                      type="checkbox"
                      id="deleteFromPlatform"
                      checked={deleteFromPlatform}
                      onChange={(e) => setDeleteFromPlatform(e.target.checked)}
                      style={{ marginTop: "3px", cursor: "pointer" }}
                    />
                    <label htmlFor="deleteFromPlatform" style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--ink)" }}>
                      <strong>Also delete from live social channel ({singleItem?.platform})</strong>
                      <span style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginTop: "2px" }}>
                        Calls the external platform API to remove the published post.
                      </span>
                    </label>
                  </div>
                )}

                <p style={{ margin: "2px 0 0 0", fontSize: "0.83rem", color: "var(--color-text-muted)" }}>
                  Are you sure you want to delete this post? This action is permanent.
                </p>

                {/* Single Delete Actions */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                  <Button variant="secondary" onClick={onClose} disabled={executing}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleExecuteDelete}
                    disabled={executing || loadingPreview}
                    style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    <Trash2 size={15} />
                    {executing ? "Deleting Post..." : "Delete Post"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          /* View 2B: Multi / Bulk Delete View */
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Filter Controls Grid (Only shown when not pre-selected) */}
            {!isPreselected && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  padding: "14px",
                  background: "var(--surface)",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                }}
              >
                {/* Scope Selector */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>
                    DELETION SCOPE
                  </label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <option value="all">All Posts (Full Workspace)</option>
                    <option value="today">Only Today&apos;s Posts</option>
                    <option value="custom_range">Custom Date Range</option>
                    {preselectedPostIds.length > 0 && (
                      <option value="selected_ids">
                        Selected Posts ({preselectedPostIds.length} items)
                      </option>
                    )}
                  </select>
                </div>

                {/* Channel Selector */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>
                    TARGET CHANNEL
                  </label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <option value="all">All Channels (All Connected)</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="telegram">Telegram</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="x">X (Twitter)</option>
                    <option value="youtube">YouTube</option>
                  </select>
                </div>

                {/* Custom Date Range Pickers (if custom_range) */}
                {scope === "custom_range" && (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>
                        FROM DATE
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--ink)",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>
                        TO DATE
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--ink)",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                  </>
                )}

                {/* Status Filter */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: "6px" }}>
                    POST STATUS
                  </label>
                  <select
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <option value="ALL">All Statuses (Published & Scheduled)</option>
                    <option value="PUBLISHED">Published Only</option>
                    <option value="ENQUEUED">Scheduled / Enqueued Only</option>
                    <option value="FAILED">Failed / Cancelled Only</option>
                  </select>
                </div>

                {/* Refresh Preview Button */}
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    onClick={fetchPreview}
                    disabled={loadingPreview}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--ink)",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                    }}
                  >
                    <RefreshCw size={14} className={loadingPreview ? "spin" : ""} />
                    {loadingPreview ? "Refreshing..." : "Update Preview"}
                  </button>
                </div>
              </div>
            )}

            {/* Social Platform Deletion Checkbox */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "rgba(99, 102, 241, 0.08)",
                border: "1px solid rgba(99, 102, 241, 0.25)",
              }}
            >
              <input
                type="checkbox"
                id="deleteFromPlatform"
                checked={deleteFromPlatform}
                onChange={(e) => setDeleteFromPlatform(e.target.checked)}
                style={{ marginTop: "3px", cursor: "pointer" }}
              />
              <label htmlFor="deleteFromPlatform" style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--ink)" }}>
                <strong>Also delete published posts directly from live social platforms (LinkedIn, Telegram, etc.)</strong>
                <span style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginTop: "2px" }}>
                  ContentOS calls platform APIs to delete published posts. If social network access is denied, the record is kept safe.
                </span>
              </label>
            </div>

            {/* Preview Section */}
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink)" }}>
                    Matching Posts ({previewData ? previewData.totalMatching : "..."})
                  </span>
                  {previewData && (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      ({selectedInPreview.length} selected for deletion)
                    </span>
                  )}
                </div>
                {previewData && previewData.items.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent)",
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {selectedInPreview.length === previewData.items.length ? "Deselect All" : "Select All"}
                  </button>
                )}
              </div>

              {/* Preview List Box */}
              <div
                style={{
                  maxHeight: "220px",
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  background: "var(--surface)",
                }}
              >
                {loadingPreview ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
                    Scanning posts across channels...
                  </div>
                ) : previewError ? (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--danger)", fontSize: "0.85rem" }}>
                    {previewError}
                  </div>
                ) : !previewData || !previewData.items || previewData.items.length === 0 ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
                    No posts found matching the selected filters.
                  </div>
                ) : (
                  previewData.items.map((item, idx) => {
                    const isChecked = selectedInPreview.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleToggleItem(item.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          borderBottom: idx < previewData.items.length - 1 ? "1px solid var(--border)" : "none",
                          cursor: "pointer",
                          background: isChecked ? "rgba(239, 68, 68, 0.05)" : "transparent",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            style={{ cursor: "pointer" }}
                          />
                          <PlatformIcon platform={item.platform} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <strong
                              style={{
                                display: "block",
                                fontSize: "0.85rem",
                                color: "var(--ink)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {item.title}
                            </strong>
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "var(--muted)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {item.snippet}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0, marginLeft: "12px" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                            {item.executeAt ? new Date(item.executeAt).toLocaleDateString() : new Date(item.createdAt).toLocaleDateString()}
                          </span>
                          <StatusBadge status={item.state} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Confirmation Guard & Action Buttons */}
            {previewData && previewData.items.length > 0 && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                }}
              >
                <ShieldAlert size={20} style={{ color: "var(--danger, #ef4444)", flexShrink: 0, marginTop: "2px" }} />
                <div style={{ flex: 1 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--danger, #ef4444)" }}>
                      I confirm the permanent deletion of {selectedInPreview.length} selected post{selectedInPreview.length > 1 ? "s" : ""}.
                    </span>
                  </label>
                  <p style={{ margin: "4px 0 0 24px", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                    This action will delete posts from your ContentOS schedule and request deletion from connected social platforms where permitted.
                  </p>
                </div>
              </div>
            )}

            {/* Modal Actions Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
              <Button variant="secondary" onClick={onClose} disabled={executing}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleExecuteDelete}
                disabled={executing || loadingPreview || !confirmed || selectedInPreview.length === 0}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <Trash2 size={15} />
                {executing
                  ? "Deleting..."
                  : `Delete ${selectedInPreview.length} Post${selectedInPreview.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

