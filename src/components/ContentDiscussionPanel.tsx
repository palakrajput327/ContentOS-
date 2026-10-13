import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare,
  UserCheck,
  CheckCircle2,
  CornerDownRight,
  Clock,
  Send,
  X,
  AtSign,
  History,
  Filter,
} from "lucide-react";
import { Button, Modal, StatusBadge } from "./ui";
import { request } from "../lib/api";
import { dateLabel, type Member, type Post } from "../lib/model";

export interface CommentItem {
  id: string;
  workspace_id: string;
  content_id: string;
  parent_id: string | null;
  author_id: string;
  author: {
    id: string;
    name: string;
    email: string;
  };
  comment: string;
  mentions: string[];
  resolved: boolean;
  created_at: string;
  updated_at: string;
  replies?: CommentItem[];
}

export interface TimelineItem {
  id: string;
  type: "activity" | "comment";
  actor: string;
  action: string;
  details: string;
  created_at: string;
}

interface ContentDiscussionPanelProps {
  open: boolean;
  onClose: () => void;
  post: Post | null;
  members: Member[];
}

export function ContentDiscussionPanel({
  open,
  onClose,
  post,
  members,
}: ContentDiscussionPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"discussion" | "timeline">("discussion");
  const [commentText, setCommentText] = useState("");
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [filterResolved, setFilterResolved] = useState<"all" | "unresolved">("unresolved");
  const [assignedTo, setAssignedTo] = useState<string | null>((post as any)?.assignedTo || null);
  const [showMentionMenu, setShowMentionMenu] = useState(false);

  useEffect(() => {
    if (post) {
      setAssignedTo((post as any).assignedTo || null);
    }
  }, [post]);

  // Fetch comments
  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ["content-comments", post?.id],
    queryFn: () =>
      post?.id
        ? request<{ comments: CommentItem[] }>(`/content/${post.id}/comments`)
        : Promise.resolve({ comments: [] }),
    enabled: !!post?.id && open,
  });

  // Fetch timeline
  const { data: timelineData, refetch: refetchTimeline } = useQuery({
    queryKey: ["content-timeline", post?.id],
    queryFn: () =>
      post?.id
        ? request<{ timeline: TimelineItem[] }>(`/content/${post.id}/timeline`)
        : Promise.resolve({ timeline: [] }),
    enabled: !!post?.id && open && activeTab === "timeline",
  });

  // Add Comment Mutation
  const addCommentMutation = useMutation({
    mutationFn: (payload: { comment: string; parentId?: string; mentions?: string[] }) =>
      request<{ comment: CommentItem }>(`/content/${post!.id}/comments`, "POST", payload),
    onSuccess: () => {
      setCommentText("");
      setReplyParentId(null);
      setSelectedMentions([]);
      refetchComments();
      refetchTimeline();
      toast.success("Comment added");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to add comment.");
    },
  });

  // Toggle Resolve Mutation
  const resolveMutation = useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: string; resolved: boolean }) =>
      request(`/content/${post!.id}/comments/${commentId}/resolve`, "PATCH", { resolved }),
    onSuccess: () => {
      refetchComments();
      refetchTimeline();
      toast.success("Comment state updated");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update comment.");
    },
  });

  // Assignment Mutation
  const assignMutation = useMutation({
    mutationFn: (newAssignee: string | null) =>
      request<{ success: boolean; assignedTo: any }>(`/content/${post!.id}/assign`, "POST", {
        assignedTo: newAssignee,
      }),
    onSuccess: (res) => {
      setAssignedTo(res.assignedTo?.id || null);
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      refetchTimeline();
      toast.success(res.assignedTo ? `Assigned to ${res.assignedTo.name}` : "Content unassigned");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to assign content.");
    },
  });

  if (!open || !post) return null;

  const comments = commentsData?.comments || [];
  const timeline = timelineData?.timeline || [];

  const filteredComments = comments.filter((c) => {
    if (filterResolved === "unresolved") {
      return !c.resolved;
    }
    return true;
  });

  const handleAddMention = (m: Member) => {
    if (!selectedMentions.includes(m.id)) {
      setSelectedMentions([...selectedMentions, m.id]);
    }
    setCommentText((prev) => `${prev} @${m.name} `);
    setShowMentionMenu(false);
  };

  const handleSendComment = () => {
    if (!commentText.trim()) return;
    addCommentMutation.mutate({
      comment: commentText,
      parentId: replyParentId || undefined,
      mentions: selectedMentions,
    });
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="" description="">
      <div style={{ padding: "4px 0" }}>
        {/* Drawer Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "14px",
            marginBottom: "16px",
          }}
        >
          <div style={{ minWidth: 0, flex: 1, paddingRight: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <StatusBadge status={post.status} />
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                Created by {post.creator}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--ink)" }}>
              {post.title || "Untitled Content"}
            </h2>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "6px",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Assignee & Controls Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "10px 14px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <UserCheck size={16} color="#818cf8" />
            <span style={{ fontSize: "0.825rem", color: "var(--ink)", fontWeight: 500 }}>
              Assignee:
            </span>
            <select
              value={assignedTo || ""}
              onChange={(e) => assignMutation.mutate(e.target.value || null)}
              disabled={assignMutation.isPending}
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--ink)",
                fontSize: "0.8rem",
                padding: "4px 8px",
                borderRadius: "6px",
              }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          </div>

          {/* Navigation Tabs */}
          <div style={{ display: "flex", gap: "6px" }}>
            <Button
              variant={activeTab === "discussion" ? "primary" : "secondary"}
              onClick={() => setActiveTab("discussion")}
              style={{ fontSize: "0.775rem", padding: "4px 10px" }}
            >
              <MessageSquare size={13} />
              Comments ({comments.length})
            </Button>

            <Button
              variant={activeTab === "timeline" ? "primary" : "secondary"}
              onClick={() => setActiveTab("timeline")}
              style={{ fontSize: "0.775rem", padding: "4px 10px" }}
            >
              <History size={13} />
              Timeline
            </Button>
          </div>
        </div>

        {/* Tab 1: Discussion & Comments */}
        {activeTab === "discussion" && (
          <div>
            {/* Filter Toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>
                Discussion Threads
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Filter size={12} color="#94a3b8" />
                <button
                  onClick={() => setFilterResolved("unresolved")}
                  style={{
                    background: filterResolved === "unresolved" ? "rgba(99, 102, 241, 0.2)" : "transparent",
                    color: filterResolved === "unresolved" ? "var(--accent)" : "#64748b",
                    border: "none",
                    borderRadius: "4px",
                    padding: "2px 8px",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  Unresolved
                </button>
                <button
                  onClick={() => setFilterResolved("all")}
                  style={{
                    background: filterResolved === "all" ? "rgba(99, 102, 241, 0.2)" : "transparent",
                    color: filterResolved === "all" ? "var(--accent)" : "#64748b",
                    border: "none",
                    borderRadius: "4px",
                    padding: "2px 8px",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  All ({comments.length})
                </button>
              </div>
            </div>

            {/* Comment List */}
            <div style={{ maxHeight: "320px", overflowY: "auto", paddingRight: "4px", marginBottom: "16px" }}>
              {filteredComments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                  {filterResolved === "unresolved" && comments.length > 0
                    ? "All comment threads are resolved!"
                    : "No comments yet. Start the conversation below."}
                </div>
              ) : (
                filteredComments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: c.resolved ? "var(--surface2)" : "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "12px",
                      marginBottom: "10px",
                      opacity: c.resolved ? 0.65 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #6366f1, #a855f7)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            color: "var(--ink)",
                          }}
                        >
                          {c.author.name[0]}
                        </span>
                        <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
                          {c.author.name}
                        </strong>
                        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                          {dateLabel(c.created_at)}
                        </span>
                      </div>

                      <button
                        onClick={() => resolveMutation.mutate({ commentId: c.id, resolved: !c.resolved })}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: c.resolved ? "var(--success)" : "var(--muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "0.75rem",
                        }}
                      >
                        <CheckCircle2 size={13} />
                        {c.resolved ? "Resolved" : "Resolve"}
                      </button>
                    </div>

                    <p style={{ margin: "4px 0 8px", fontSize: "0.85rem", color: "var(--ink)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {c.comment}
                    </p>

                    {/* Action Bar for Parent Comment */}
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <button
                        onClick={() => {
                          setReplyParentId(replyParentId === c.id ? null : c.id);
                          setCommentText("");
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: replyParentId === c.id ? "var(--accent)" : "var(--muted)",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <CornerDownRight size={12} />
                        {replyParentId === c.id ? "Cancel Reply" : "Reply"}
                      </button>
                    </div>

                    {/* Nested Replies */}
                    {c.replies && c.replies.length > 0 && (
                      <div style={{ marginTop: "10px", paddingLeft: "16px", borderLeft: "2px solid rgba(99, 102, 241, 0.3)" }}>
                        {c.replies.map((reply) => (
                          <div key={reply.id} style={{ marginTop: "8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                              <strong style={{ fontSize: "0.8rem", color: "var(--ink)" }}>
                                {reply.author.name}
                              </strong>
                              <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                                {dateLabel(reply.created_at)}
                              </span>
                            </div>
                            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink)", lineHeight: 1.4 }}>
                              {reply.comment}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Comment Form */}
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "12px",
                position: "relative",
              }}
            >
              {replyParentId && (
                <div style={{ fontSize: "0.75rem", color: "var(--accent)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
                  <CornerDownRight size={12} />
                  Replying to comment thread…
                </div>
              )}

              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={replyParentId ? "Write a reply…" : "Add a comment or @mention a teammate…"}
                rows={2}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--ink)",
                  fontSize: "0.85rem",
                  resize: "none",
                }}
              />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px", borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setShowMentionMenu(!showMentionMenu)}
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: "var(--accent)",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <AtSign size={13} />
                    Mention member
                  </button>

                  {showMentionMenu && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "100%",
                        left: 0,
                        marginBottom: "6px",
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                        zIndex: 20,
                        minWidth: "180px",
                        padding: "4px",
                      }}
                    >
                      {members.map((m) => (
                        <div
                          key={m.id}
                          onClick={() => handleAddMention(m)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            color: "var(--ink)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{m.name}</span>
                          <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>{m.role}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleSendComment}
                  disabled={addCommentMutation.isPending || !commentText.trim()}
                  variant="primary"
                  style={{ fontSize: "0.8rem", padding: "5px 12px", gap: "6px" }}
                >
                  <Send size={13} />
                  {addCommentMutation.isPending ? "Posting…" : "Post Comment"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Activity & Approval Timeline */}
        {activeTab === "timeline" && (
          <div style={{ maxHeight: "420px", overflowY: "auto", paddingRight: "4px" }}>
            {timeline.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                No activity history recorded yet for this content item.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {timeline.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <div style={{ marginTop: "2px", color: item.type === "comment" ? "#a855f7" : "var(--accent)" }}>
                      {item.type === "comment" ? <MessageSquare size={14} /> : <Clock size={14} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--ink)" }}>
                          {item.actor}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                          {dateLabel(item.created_at)}
                        </span>
                      </div>

                      <div style={{ fontSize: "0.78rem", color: "var(--accent)", fontWeight: 500 }}>
                        {item.action}
                      </div>

                      {item.details && (
                        <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.4 }}>
                          {item.details}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
