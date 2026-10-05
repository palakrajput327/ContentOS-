import { useState, useEffect, useRef } from "react";
import { Bell, Check, CheckCheck, Info, CheckCircle, AlertTriangle, XCircle, Clock } from "lucide-react";
import { request } from "../lib/api";
import { toast } from "sonner";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  data?: Record<string, any>;
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchNotifications();

    // Poll every 30 seconds for new notifications
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function fetchNotifications() {
    try {
      const res = (await request("/notifications")) as {
        notifications: NotificationItem[];
        unreadCount: number;
      };
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }

  async function handleMarkRead(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await request(`/notifications/${id}/read`, "POST", {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      toast.error("Failed to mark notification as read.");
    }
  }

  async function handleMarkAllRead() {
    try {
      await request("/notifications/read-all", "POST", {});
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      toast.success("All notifications marked as read.");
    } catch (err) {
      toast.error("Failed to mark all notifications as read.");
    }
  }

  function getNotificationIcon(type: string) {
    switch (type) {
      case "approved":
        return <CheckCircle size={16} style={{ color: "#34d399" }} />;
      case "rejected":
      case "publish_failed":
      case "batch_failed":
        return <XCircle size={16} style={{ color: "#f87171" }} />;
      case "batch_partial":
        return <AlertTriangle size={16} style={{ color: "#fbbf24" }} />;
      case "scheduled":
        return <Clock size={16} style={{ color: "#6366f1" }} />;
      default:
        return <Info size={16} style={{ color: "#3b82f6" }} />;
    }
  }

  return (
    <div ref={panelRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className="icon-button"
        style={{
          position: "relative",
          padding: "8px",
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          color: "#fff",
          cursor: "pointer",
        }}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              background: "#ef4444",
              color: "#fff",
              fontSize: "0.7rem",
              fontWeight: 700,
              borderRadius: "10px",
              minWidth: "18px",
              height: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              boxShadow: "0 0 6px rgba(239, 68, 68, 0.5)",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="panel"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 10px)",
            width: "360px",
            maxHeight: "480px",
            display: "flex",
            flexDirection: "column",
            borderRadius: "14px",
            overflow: "hidden",
            zIndex: 9999,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            background: "var(--color-bg-panel, #18181b)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255, 255, 255, 0.02)",
            }}
          >
            <strong style={{ fontSize: "0.95rem", color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
              <Bell size={16} style={{ color: "#6366f1" }} />
              Notifications {unreadCount > 0 && `(${unreadCount})`}
            </strong>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#6366f1",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
                No notifications right now.
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                    background: item.read ? "transparent" : "rgba(99, 102, 241, 0.06)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    transition: "background 0.2s ease",
                  }}
                >
                  <div style={{ marginTop: "2px" }}>{getNotificationIcon(item.type)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px" }}>
                      <strong style={{ fontSize: "0.85rem", color: item.read ? "var(--color-text-muted)" : "#fff" }}>
                        {item.title}
                      </strong>
                      <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
                        {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.4 }}>
                      {item.message}
                    </p>
                  </div>
                  {!item.read && (
                    <button
                      onClick={(e) => handleMarkRead(item.id, e)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-text-muted)",
                        cursor: "pointer",
                        padding: "2px",
                      }}
                      title="Mark as read"
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
