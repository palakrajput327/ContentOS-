import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  Pencil,
  Trash2,
  X,
  ShieldCheck,
  TriangleAlert,
  LoaderCircle,
  UserCheck,
  UserX,
} from "lucide-react";
import { ModalFrame, Button } from "./ui";
import { request } from "../lib/api";

export default function AdminUserActions({
  user,
  onView,
}: {
  user: any;
  onView: () => void;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [note, setNote] = useState("");
  const [impact, setImpact] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  function close() {
    if (!busy && !loading) {
      setMode(null);
      setError("");
    }
  }

  async function open(next: "edit" | "delete") {
    setMode(next);
    setError("");
    setName(user.name || "");
    setPhone(user.phoneNumber || (user.phone !== "Not recorded" ? user.phone : "") || "");
    setStatus(user.accountStatus || "ACTIVE");
    setNote(user.adminNote || "");
    setImpact(null);
    if (next === "delete") {
      setLoading(true);
      try {
        setImpact(await request(`/admin/users/${user.id}/impact`));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload =
        mode === "delete"
          ? { confirmation: user.email, version: user.adminVersion }
          : {
              name: name.trim(),
              phone: phone.trim(),
              status,
              note: note.trim(),
              version: user.adminVersion,
            };
      const result = await request<any>(
        `/admin/users/${user.id}`,
        mode === "delete" ? "DELETE" : "PATCH",
        payload,
      );
      await client.invalidateQueries({ queryKey: ["super-admin"] });
      setMode(null);
      toast.success(
        mode === "delete"
          ? "User deleted"
          : `User status set to ${status === "ACTIVE" ? "Active" : "Inactive"}`,
        { description: result.message || "Changes saved successfully." },
      );
    } catch (e: any) {
      setError(e.message || "Failed to update user");
      toast.error("Changes could not be saved", { description: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-user-actions">
        <button type="button" onClick={onView} title="View user details">
          <Eye size={14} />
          <span>View</span>
        </button>
        <button
          type="button"
          onClick={() => open("edit")}
          disabled={user.accountStatus === "DELETED"}
          title="Edit user info & status"
        >
          <Pencil size={14} />
          <span>Edit</span>
        </button>
        <button
          type="button"
          className="admin-delete-action"
          onClick={() => open("delete")}
          disabled={user.accountStatus === "DELETED"}
          title="Delete user"
        >
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>

      <ModalFrame
        open={!!mode}
        onClose={close}
        title={mode === "edit" ? "Edit user" : "Delete user"}
        className="admin-user-dialog"
      >
        <div className="admin-user-dialog-header">
          <span className={`admin-dialog-icon ${mode === "delete" ? "danger" : ""}`}>
            {mode === "edit" ? <ShieldCheck size={22} /> : <TriangleAlert size={22} />}
          </span>
          <button
            type="button"
            aria-label="Close dialog"
            disabled={busy || loading}
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>

        <h2>{mode === "edit" ? "Edit User Info" : "Delete this account?"}</h2>
        <p className="admin-dialog-description">{user.email}</p>

        <form onSubmit={save} className="admin-dialog-form">
          <div className="admin-dialog-body">
            {mode === "edit" ? (
              <>
                <label>
                  <span>Display name</span>
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    placeholder="User full name"
                  />
                </label>

                <label>
                  <span>Phone number (optional)</span>
                  <input
                    maxLength={30}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={busy}
                    placeholder="+91 9876543210"
                  />
                </label>

                <label>
                  <span>Account status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={busy}
                  >
                    <option value="ACTIVE">Active · Access enabled (can sign in)</option>
                    <option value="SUSPENDED">Inactive · Access disabled (suspended)</option>
                  </select>
                </label>

                {status === "SUSPENDED" && (
                  <div
                    className="admin-dialog-notice"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      borderColor: "rgba(245, 158, 11, 0.4)",
                      background: "rgba(245, 158, 11, 0.08)",
                      color: "#fbbf24",
                    }}
                  >
                    <UserX size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
                      <strong>Account will be marked Inactive:</strong> Active sessions are revoked immediately and further logins will be blocked. Workspace posts and history are preserved.
                    </div>
                  </div>
                )}

                {status === "ACTIVE" && user.accountStatus === "SUSPENDED" && (
                  <div
                    className="admin-dialog-notice"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      borderColor: "rgba(34, 197, 94, 0.4)",
                      background: "rgba(34, 197, 94, 0.08)",
                      color: "#4ade80",
                    }}
                  >
                    <UserCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
                      <strong>Account will be marked Active:</strong> The user will regain permission to sign in and manage their workspaces.
                    </div>
                  </div>
                )}

                <label>
                  <span>Internal admin note</span>
                  <textarea
                    maxLength={500}
                    rows={2}
                    placeholder="Reason or support context (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={busy}
                  />
                  <small>{note.length}/500 · visible to Super Admin only</small>
                </label>

                <p className="admin-dialog-description" style={{ margin: "4px 0 0" }}>
                  Email verification and workspace roles remain separate from account status.
                </p>
              </>
            ) : (
              <>
                {loading ? (
                  <p role="status">
                    <LoaderCircle size={16} className="admin-spin" /> Checking account impact…
                  </p>
                ) : (
                  impact && (
                    <>
                      <div className="admin-delete-impact">
                        <span>
                          <strong>{impact.posts}</strong> created posts
                        </span>
                        <span>
                          <strong>{impact.memberships}</strong> memberships
                        </span>
                      </div>
                      <div className="admin-dialog-notice">{impact.policy}</div>
                      <p className="admin-dialog-description">
                        Click Confirm deletion to permanently remove account access for this user.
                      </p>
                    </>
                  )
                )}
              </>
            )}

            {error && (
              <p className="admin-error" role="alert" style={{ margin: "8px 0" }}>
                {error}
              </p>
            )}
          </div>

          <div className="admin-dialog-footer">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || loading}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={mode === "delete" ? "admin-danger-button" : ""}
              disabled={busy || loading || (mode === "delete" && !impact?.canDelete)}
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="admin-spin" /> Saving…
                </>
              ) : mode === "edit" ? (
                "Save changes"
              ) : (
                "Confirm deletion"
              )}
            </Button>
          </div>
        </form>
      </ModalFrame>
    </>
  );
}
