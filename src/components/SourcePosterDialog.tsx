import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, ModalFrame } from "./ui";
import { data, request, resolveMediaUrl } from "../lib/api";
import { type Snapshot, type Platform } from "../lib/model";
interface Result {
  assetId: string;
  url: string;
  filename: string;
  sourceEvidence: Record<string, unknown>;
}
export function SourcePosterDialog({
  documentId,
  sourceId,
  imageUrl,
  pageNumber,
  onClose,
}: {
  documentId: string;
  sourceId: string;
  imageUrl: string;
  pageNumber: number;
  onClose: () => void;
}) {
  const workspace = useOutletContext<Snapshot>(),
    query = useQueryClient(),
    navigate = useNavigate();
  const [headline, setHeadline] = useState(""),
    [subtitle, setSubtitle] = useState(""),
    [cta, setCta] = useState(workspace.brand.cta || ""),
    [caption, setCaption] = useState(""),
    [format, setFormat] = useState("square"),
    [color, setColor] = useState(
      (workspace.brand as any).primaryColor || "#704bd6",
    ),
    [logo, setLogo] = useState(""),
    [logos, setLogos] = useState<
      Array<{ id: string; original_filename: string }>
    >([]),
    [selected, setSelected] = useState<Platform[]>(["LinkedIn"]);
  const [result, setResult] = useState<Result | null>(null),
    [renderedSignature, setRenderedSignature] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [savedPostId, setSavedPostId] = useState<string>();
  const signature = JSON.stringify([
    headline,
    subtitle,
    cta,
    format,
    color,
    logo,
  ]);
  const fresh = !!result && signature === renderedSignature;
  useEffect(() => {
    let canceled = false;
    request<{
      media: Array<{
        id: string;
        original_filename: string;
        mime_type: string;
        status: string;
      }>;
    }>("/storage/media?type=IMAGE")
      .then((value) => {
        if (!canceled)
          setLogos(
            value.media.filter(
              (m) =>
                m.status === "COMPLETED" &&
                ["image/png", "image/jpeg", "image/webp"].includes(m.mime_type),
            ),
          );
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, []);
  async function render() {
    setBusy(true);
    setError("");
    try {
      const value = await request<Result>(
        `/documents/${documentId}/source-media/${sourceId}/poster`,
        "POST",
        {
          headline,
          subtitle,
          cta,
          format,
          primaryColor: color,
          ...(logo ? { logoAssetId: logo } : {}),
        },
      );
      setResult(value);
      setRenderedSignature(signature);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!result || !fresh) return;
    setBusy(true);
    setError("");
    try {
      const variants = Object.fromEntries(
        selected.map((p) => [
          p,
          {
            caption: caption.trim() || headline,
            mediaAssetId: result.assetId,
            mediaType: "image",
            metadata: { sourceMediaEvidence: result.sourceEvidence },
          },
        ]),
      );
      const post = await data.save({
        id: savedPostId,
        title: headline,
        body: caption.trim() || headline,
        platforms: selected,
        variants,
      });
      setSavedPostId(post.id);
      await data.transition(post.id, "review");
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Source-image poster saved · Needs Review");
      onClose();
      navigate("/app/approvals");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalFrame
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Create a source-image poster"
      className="source-poster-dialog"
    >
      <div className="source-dialog-header">
        <div>
          <h2>Create a source-image poster</h2>
          <p>
            Original image from page {pageNumber}. Your final post will require
            review.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={onClose}
          aria-label="Close source poster builder"
        >
          Close
        </Button>
      </div>
      <div className="source-poster-grid">
        <div className="source-poster-fields">
          {error && (
            <p role="alert" className="source-error">
              {error}
            </p>
          )}
          <label>
            Headline
            <input
              value={headline}
              maxLength={100}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Introduce your product or service"
              disabled={busy}
            />
          </label>
          <label>
            Description
            <textarea
              value={subtitle}
              maxLength={180}
              onChange={(e) => setSubtitle(e.target.value)}
              rows={2}
              disabled={busy}
            />
          </label>
          <label>
            Call to action
            <input
              value={cta}
              maxLength={48}
              onChange={(e) => setCta(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className="source-form-row">
            <label>
              Poster format
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                disabled={busy}
              >
                <option value="square">Square · 1:1</option>
                <option value="portrait">Portrait · 4:5</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <label>
              Brand accent
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <label>
            Workspace logo
            <select
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              disabled={busy}
            >
              <option value="">Brand name only</option>
              {logos.map((asset) => (
                <option value={asset.id} key={asset.id}>
                  {asset.original_filename}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy || !headline.trim()} onClick={render}>
            {busy
              ? "Preparing…"
              : fresh
                ? "Refresh preview"
                : "Generate poster"}
          </Button>
          <label>
            Post caption
            <textarea
              value={caption}
              maxLength={3000}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder="Write the caption to accompany this poster"
              disabled={busy}
            />
          </label>
          <fieldset>
            <legend>Publish destinations</legend>
            <div className="source-platforms">
              {(
                [
                  "LinkedIn",
                  "Instagram",
                  "Facebook",
                  "X",
                  "Telegram",
                ] as Platform[]
              ).map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p)}
                    disabled={busy}
                    onChange={() =>
                      setSelected((rows) =>
                        rows.includes(p)
                          ? rows.filter((x) => x !== p)
                          : [...rows, p],
                      )
                    }
                  />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>
          {selected.includes("X") && (caption || headline).length > 280 && (
            <p className="source-error">
              Shorten the caption to 280 characters for X.
            </p>
          )}
          <Button
            disabled={
              busy ||
              !fresh ||
              !selected.length ||
              (selected.includes("X") && (caption || headline).length > 280)
            }
            onClick={save}
          >
            Save to review
          </Button>
        </div>
        <div className="source-poster-preview">
          <img
            src={resolveMediaUrl(result?.url || imageUrl)}
            crossOrigin="anonymous"
            alt={result ? "Generated branded poster" : "Original source image"}
          />
          {result && !fresh && (
            <p>
              Poster details changed. Generate a fresh preview before saving.
            </p>
          )}
          <p>
            {result ? "Generated creative" : "Original source image"} · The
            original PDF and its image remain unchanged.
          </p>
        </div>
      </div>
    </ModalFrame>
  );
}
