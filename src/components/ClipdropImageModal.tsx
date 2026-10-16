import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Scissors,
  Check,
  X,
  Loader2,
  Layers,
  Zap,
  Download,
  Share2,
  Send,
  Eye,
  RefreshCw,
  Palette,
  ExternalLink,
  CheckCircle2,
  Sliders,
  Globe,
  Maximize2,
  Copy,
  CheckCheck,
  Type,
  Crown,
  Edit3,
} from "lucide-react";
import { clipdropApi, request } from "../lib/api";
import { useSession } from '../lib/session';
import { ModalFrame } from "./ui";
import type { Account } from "../lib/model";

export interface ClipdropImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach?: (result: { assetId: string; url: string; filename: string }) => void;
  initialContentText?: string;
  initialTitle?: string;
  contentId?: string;
  targetPlatform?: string;
  accounts?: Account[];
  brandName?: string;
  brandWebsite?: string;
  brandCta?: string;
  composerMode?: boolean;
  attachmentLabel?: string;
  initialAsset?: {assetId:string;url:string;filename:string};
}

/**
 * Intelligently analyzes image generation prompts to classify intent:
 * - Branded festive posters (Diwali, New Year, Christmas, Holi, Eid, Independence Day, etc.)
 * - Corporate announcements & hiring posters
 * - General visual art (e.g. "create a image of owl with red eyes", "cyberpunk street", "portrait of lion")
 */
function analyzePromptForBranding(text: string): {
  isBrandedRequest: boolean;
  detectedHeadline: string;
  detectedSubtitle: string;
  detectedCompany: string;
} {
  const p = text.trim();
  if (!p) {
    return {
      isBrandedRequest: false,
      detectedHeadline: "",
      detectedSubtitle: "",
      detectedCompany: "",
    };
  }

  // 1. Detect Company / Brand Name if explicitly mentioned in prompt
  let detectedCompany = "";
  const companyMatch = p.match(/(?:with\s+company\s+(?:name\s+)?|company(?:\s+name)?\s*:\s*|by\s+|from\s+|for\s+|at\s+)([a-zA-Z0-9\s&]{2,45}?(?:pvt|private|limited|ltd|company|corp|solutions|tech|studio|agency|enterprises|ventures|[A-Z][a-zA-Z0-9\s&]{2,30}))/i);
  if (companyMatch) {
    let rawComp = companyMatch[1].trim();
    rawComp = rawComp.replace(/\s+(?:poster|banner|image|graphic|post|with|and)$/i, "").trim();
    if (rawComp.length >= 2) {
      detectedCompany = rawComp.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // 2. Check if user explicitly asked for a Poster, Greeting, Card, Banner, or Announcement
  const isPosterOrBanner = /(?:poster|banner|flyer|greeting|card|announcement|wishing)/i.test(p);

  // 3. Detect Festivals & Holidays
  if (/diwali|deepavali/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Happy Diwali",
        detectedSubtitle: "Wishing joy, prosperity, and radiant light to you and your loved ones!",
        detectedCompany,
      };
    }
  } else if (/new\s*year/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Happy New Year",
        detectedSubtitle: "Wishing you 365 days of remarkable innovation, prosperity and inspiring success!",
        detectedCompany,
      };
    }
  } else if (/christmas|xmas/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Merry Christmas",
        detectedSubtitle: "Wishing you peace, cheer and happiness this holiday season!",
        detectedCompany,
      };
    }
  } else if (/holi/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Happy Holi",
        detectedSubtitle: "May your life be painted with vibrant colors of joy, good health and prosperity!",
        detectedCompany,
      };
    }
  } else if (/eid/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Eid Mubarak",
        detectedSubtitle: "May divine blessings, peace, harmony and happiness fill your home and life!",
        detectedCompany,
      };
    }
  } else if (/independence\s*day/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Happy Independence Day",
        detectedSubtitle: "Saluting the pride, unity and glorious freedom of our great nation!",
        detectedCompany,
      };
    }
  } else if (/republic\s*day/i.test(p)) {
    if (detectedCompany || isPosterOrBanner) {
      return {
        isBrandedRequest: true,
        detectedHeadline: "Happy Republic Day",
        detectedSubtitle: "Celebrating democracy, unity and sovereignty with pride and dedication!",
        detectedCompany,
      };
    }
  }

  // 4. Corporate Announcements (Hiring, Launch, Offer)
  if (/we\s+are\s+hiring|job\s+vacancy|now\s+hiring|career\s+opportunity/i.test(p)) {
    return {
      isBrandedRequest: true,
      detectedHeadline: "We Are Hiring",
      detectedSubtitle: "Join our fast-growing team and build the future of technology with us!",
      detectedCompany,
    };
  }

  if (/product\s+launch|launching|announcing/i.test(p) && (isPosterOrBanner || detectedCompany)) {
    return {
      isBrandedRequest: true,
      detectedHeadline: "Product Launch Announcement",
      detectedSubtitle: "Discover next-generation capabilities designed to elevate your workflows.",
      detectedCompany,
    };
  }

  // 5. Explicit company poster requested
  if (detectedCompany && isPosterOrBanner) {
    return {
      isBrandedRequest: true,
      detectedHeadline: detectedCompany,
      detectedSubtitle: "Empowering innovation and excellence in every milestone.",
      detectedCompany,
    };
  }

  // 6. DEFAULT: Pure visual, object, living being, nature, everything else
  return {
    isBrandedRequest: false,
    detectedHeadline: "",
    detectedSubtitle: "",
    detectedCompany: "",
  };
}

export const ClipdropImageModal: React.FC<ClipdropImageModalProps> = ({
  isOpen,
  onClose,
  onAttach,
  initialContentText = "",
  initialTitle = "",
  contentId,
  targetPlatform = "LinkedIn",
  accounts = [],
  brandName = "Hindustan Software Solution",
  brandWebsite = "hindustansoftwaresolution.com",
  brandCta = "Learn More",
  composerMode = false,
  attachmentLabel = 'Image for this post',
  initialAsset,
}) => {
  // Engine & Prompt
  const [engine, setEngine] = useState<"clipdrop" | "flux">("clipdrop");
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<string>("3d-render");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "4:5" | "9:16" | "16:9">("1:1");

  // Dynamic Prompt-Driven Overlay States
  const [enableBrandOverlay, setEnableBrandOverlay] = useState(false);
  const [headline, setHeadline] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [logoText, setLogoText] = useState("");

  // Loading States
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [isSavingPost, setIsSavingPost] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPreparingVisual,setIsPreparingVisual] = useState(false);
  const [renderedAsset,setRenderedAsset] = useState<{signature:string;asset:{assetId:string;url:string;filename:string}} | null>(null);

  // Result States
  const [generatedAsset, setGeneratedAsset] = useState<{
    assetId: string;
    url: string;
    filename: string;
    engine?: string;
    remainingCredits: number | null;
  } | null>(null);

  const [savedPostId, setSavedPostId] = useState<string | null>(contentId || null);
  const [isAttached, setIsAttached] = useState(false);
  const [publishedInfo, setPublishedInfo] = useState<{ channel: string; at: string } | null>(null);
  const [publishResults, setPublishResults] = useState<Array<{platform:string;status:string;postId?:string;error?:string}>>([]);
  const [selectedSocialAccountIds, setSelectedSocialAccountIds] = useState<string[]>([]);
  const [postCaption, setPostCaption] = useState<string>(initialContentText || "");
  const [captionManuallyEdited, setCaptionManuallyEdited] = useState(false);

  // Memoized connected accounts from active workspace
  const connectedAccounts = React.useMemo(() => {
    return (accounts || []).filter((a) => a.state?.toLowerCase() === "connected");
  }, [accounts]);

  // Target accounts currently selected
  const targetAccounts = React.useMemo(() => {
    return connectedAccounts.filter((a) => selectedSocialAccountIds.includes(a.id));
  }, [connectedAccounts, selectedSocialAccountIds]);

  // ChatGPT / Midjourney Studio Generation States
  const [generationStep, setGenerationStep] = useState(0);
  const [generationPercent, setGenerationPercent] = useState(14);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [isFullscreenZoom, setIsFullscreenZoom] = useState(false);

  const generationSteps = [
    { title: "Analyzing Creative Prompt", subtitle: "Parsing scene semantics, visual styling & composition...", color: "var(--accent)", badge: "01 / 04" },
    { title: "Constructing Scene Geometry", subtitle: "Balancing composition depth, 3D volume & lighting...", color: "var(--accent)", badge: "02 / 04" },
    { title: "Synthesizing Neural Diffusion", subtitle: "Generating high-fidelity 8K textures, colors & atmosphere...", color: "var(--accent)", badge: "03 / 04" },
    { title: "Final Polish & Upscaling", subtitle: "Applying neural chromatic polish and balance...", color: "var(--success)", badge: "04 / 04" },
  ];

  // Progressive percent counter while generating
  useEffect(() => {
    let timer: any;
    if (isGenerating) {
      setGenerationPercent(14);
      timer = setInterval(() => {
        setGenerationPercent((prev) => {
          if (prev >= 96) return 96;
          const jump = Math.floor(Math.random() * 8) + 4;
          return Math.min(prev + jump, 96);
        });
      }, 400);
    } else {
      setGenerationPercent(100);
    }
    return () => clearInterval(timer);
  }, [isGenerating]);

  // Progressive generation steps
  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      setGenerationStep(0);
      setImageLoaded(false);
      setImageError(false);
      interval = setInterval(() => {
        setGenerationStep((prev) => (prev + 1) % 4);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Dynamic prompt analyzer: adapts branding overlay strictly according to the active prompt intent
  useEffect(() => {
    if (!prompt || !prompt.trim()) {
      setEnableBrandOverlay(false);
      setHeadline("");
      setSubtitle("");
      return;
    }

    const analysis = analyzePromptForBranding(prompt);
    if (analysis.isBrandedRequest) {
      setEnableBrandOverlay(true);
      setHeadline(analysis.detectedHeadline);
      setSubtitle(analysis.detectedSubtitle);
      if (analysis.detectedCompany) {
        setLogoText(analysis.detectedCompany);
      }
    } else {
      // General visual/art prompt (e.g. "create a image of owl with red eyes", "cyberpunk street", etc.)
      setEnableBrandOverlay(false);
      setHeadline("");
      setSubtitle("");
    }
  }, [prompt]);

  useEffect(() => {
    if (!captionManuallyEdited && prompt && !initialContentText) {
      setPostCaption(prompt);
    }
  }, [prompt, captionManuallyEdited, initialContentText]);

  useEffect(() => {
    if (isOpen) {
      if (composerMode && initialAsset && initialAsset.url !== generatedAsset?.url && initialAsset.assetId !== renderedAsset?.asset.assetId) {
        setGeneratedAsset({...initialAsset,remainingCredits:null});
        setEnableBrandOverlay(false);
        setIsAttached(true);
      }
      if (targetPlatform === "YouTube") setAspectRatio("16:9");
      else if (targetPlatform === "LinkedIn") setAspectRatio("1:1");
      else if (targetPlatform === "Instagram") setAspectRatio("4:5");
      else if (targetPlatform === "Telegram") setAspectRatio("4:5");

      if (initialContentText && !captionManuallyEdited) {
        setPostCaption(initialContentText);
      }

      // Pre-select connected social accounts reliably
      if (connectedAccounts.length > 0) {
        setSelectedSocialAccountIds((prev) => {
          const valid = prev.filter((id) => connectedAccounts.some((a) => a.id === id));
          if (valid.length > 0) return valid;
          return connectedAccounts.map((a) => a.id);
        });
      }
    }
  }, [isOpen, targetPlatform, connectedAccounts, initialContentText, captionManuallyEdited]);

  if (!isOpen) return null;

  async function handleSuggestPrompt() {
    try {
      setIsSuggesting(true);
      const res = await clipdropApi.suggestPrompt(
        initialContentText || headline || "AI technology transformation and productivity",
        targetPlatform,
      );
      setPrompt(res.prompt);
      toast.success("AI suggested a high-impact visual prompt!");
    } catch (err: any) {
      console.error("Suggest prompt error:", err);
      toast.error("Could not suggest prompt automatically. You can type one below!");
    } finally {
      setIsSuggesting(false);
    }
  }

  async function handleGenerate(isVariation: boolean = false) {
    if (!prompt.trim()) {
      toast.error("Please enter an image prompt.");
      return;
    }

    try {
      setIsGenerating(true);
      const uniqueKey = isVariation ? `${Date.now()}_${Math.random().toString(36).substring(7)}` : undefined;

      let res;
      try {
        res = await clipdropApi.generateImage({
          prompt: prompt.trim(),
          engine,
          stylePreset,
          aspectRatio,
          enableOverlay: false,
          contentId: composerMode ? undefined : savedPostId || undefined,
          platform: targetPlatform,
          idempotencyKey: uniqueKey,
        });
      } catch (firstErr: any) {
        if (engine === "flux") {
          toast.info("Free engine was busy. Switching to Clipdrop AI...");
          res = await clipdropApi.generateImage({
            prompt: prompt.trim(),
            engine: "clipdrop",
            stylePreset,
            aspectRatio,
            enableOverlay: false,
            contentId: composerMode ? undefined : savedPostId || undefined,
            platform: targetPlatform,
            idempotencyKey: uniqueKey,
          });
          setEngine("clipdrop");
        } else {
          throw firstErr;
        }
      }

      setGeneratedAsset({
        assetId: res.assetId,
        url: res.url,
        filename: res.filename,
        engine: res.engine || engine,
        remainingCredits: res.remainingCredits,
      });

      setIsAttached(true);
      if (res.contentId) {
        setSavedPostId(res.contentId);
      }

      toast.success(
        res.engine === "flux"
          ? "Generated with FLUX.1 Pro (Free & Unlimited)!"
          : "Generated visual with Clipdrop AI!"
      );

      if (onAttach) {
        onAttach({
          assetId: res.assetId,
          url: res.url,
          filename: res.filename,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate image.");
    } finally {
      setIsGenerating(false);
    }
  }

  // 1-Click Clipboard Image Copy
  async function handleCopyImage() {
    if (!generatedAsset?.url) return;
    try {
      const res = await fetch(generatedAsset.url);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      setCopiedImage(true);
      toast.success("Image copied to clipboard!");
      setTimeout(() => setCopiedImage(false), 2000);
    } catch (err) {
      await navigator.clipboard.writeText(window.location.origin + generatedAsset.url);
      toast.success("Image URL copied to clipboard!");
    }
  }

  // High-Res Image & Branded Poster Download
  async function renderVisual(): Promise<Blob> {
    if (!generatedAsset?.url) throw new Error('Generate an image first.');
      if (!enableBrandOverlay || (!headline && !subtitle && !logoText)) {
        const res = await fetch(generatedAsset.url);
        if (!res.ok) throw new Error('Image could not be loaded. Regenerate or re-upload it.');
        return res.blob();
      }

      toast.info("Preparing branded poster with company name...");
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = generatedAsset.url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create canvas context");

      // 1. Draw base visual
      ctx.drawImage(img, 0, 0, w, h);

      // 2. Top Floating Frosted-Glass Pill Badge: Company Name (Only if logoText exists)
      if (logoText) {
        const compName = logoText.toUpperCase();
        const badgeFontSize = Math.round(w * 0.024);
        ctx.font = `bold ${badgeFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const textMetrics = ctx.measureText(`✨  ${compName}  ✨`);
        const badgeW = Math.min(w * 0.88, Math.max(280, textMetrics.width + 48));
        const badgeH = Math.round(h * 0.055);
        const badgeX = (w - badgeW) / 2;
        const badgeY = Math.round(h * 0.038);

        ctx.save();
        ctx.fillStyle = "rgba(10, 15, 30, 0.82)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
        ctx.lineWidth = Math.max(1, Math.round(w * 0.002));
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === "function") {
          (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2);
        } else {
          ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 8;
        ctx.fillText(`✨  ${compName}  ✨`, w / 2, badgeY + badgeH / 2);
        ctx.restore();
      }

      // 3. Bottom Floating Frosted-Glass Banner: Headline & Greeting Message
      if (headline || subtitle) {
        const cardW = Math.round(w * 0.9);
        const cardH = Math.round(h * 0.175);
        const cardX = (w - cardW) / 2;
        const cardY = h - cardH - Math.round(h * 0.038);

        ctx.save();
        ctx.fillStyle = "rgba(8, 12, 24, 0.86)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.4)";
        ctx.lineWidth = Math.max(1, Math.round(w * 0.002));
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === "function") {
          (ctx as any).roundRect(cardX, cardY, cardW, cardH, 20);
        } else {
          ctx.rect(cardX, cardY, cardW, cardH);
        }
        ctx.fill();
        ctx.stroke();

        // Title / Headline
        if (headline) {
          ctx.font = `bold ${Math.round(cardH * 0.35)}px Georgia, serif`;
          ctx.fillStyle = "#fef08a";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(234, 179, 8, 0.6)";
          ctx.shadowBlur = 14;
          ctx.fillText(headline, w / 2, cardY + cardH * (subtitle ? 0.36 : 0.5));
          ctx.shadowBlur = 0;
        }

        // Subtitle greeting / message
        if (subtitle) {
          ctx.font = `500 ${Math.round(cardH * 0.16)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.fillStyle = "#f1f5f9";
          ctx.textAlign = "center";
          ctx.fillText(subtitle, w / 2, cardY + cardH * (headline ? 0.66 : 0.5));
        }

        // Sign-off
        if (logoText) {
          ctx.font = `600 ${Math.round(cardH * 0.12)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.fillStyle = "#94a3b8";
          ctx.textAlign = "center";
          ctx.fillText(`Warm Greetings from ${logoText}`, w / 2, cardY + cardH * 0.86);
        }
        ctx.restore();
      }

      return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Canvas export failed.')),'image/png'));
  }

  async function handleDownloadImage() {
    try {
      const blob=await renderVisual();
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=enableBrandOverlay?'branded_poster.png':generatedAsset?.filename || 'ai_visual.png';
      link.click();URL.revokeObjectURL(url);
      toast.success('Visual downloaded.');
    } catch(error) {toast.error((error as Error).message);}
  }

  async function visualAssetForPost() {
    if (!generatedAsset) throw new Error('Generate an image first.');
    if (!enableBrandOverlay || (!headline && !subtitle && !logoText)) return generatedAsset;
    const signature=JSON.stringify([generatedAsset.assetId,generatedAsset.url,headline,subtitle,logoText]);
    if (renderedAsset?.signature===signature) return renderedAsset.asset;
    setIsPreparingVisual(true);
    try {
      const blob=await renderVisual();
      const filename='branded_poster.png';
      const upload=await request<{assetId:string;uploadUrl:string;headers?:Record<string,string>}>('/storage/uploads/presign','POST',{type:'IMAGE',originalFilename:filename,mimeType:'image/png',sizeBytes:blob.size});
      const workspaceId=useSession.getState().workspaceId;
      const apiBase = import.meta.env.VITE_API_BASE ?? "";
      const targetUpload = upload.uploadUrl.startsWith("/") ? `${apiBase}${upload.uploadUrl}` : upload.uploadUrl;
      const response=await fetch(targetUpload,{method:'PUT',credentials:'include',headers:{'Content-Type':'image/png',...(workspaceId?{'X-Workspace-Id':workspaceId}:{}),...upload.headers},body:blob});
      if(!response.ok)throw new Error('Branded image upload failed. Your original image is preserved.');
      await request(`/storage/uploads/${upload.assetId}/complete`,'POST',{});
      const media=await request<{downloadUrl:string}>(`/storage/media/${upload.assetId}/download`);
      const resolvedMediaUrl = media.downloadUrl.startsWith("/") ? `${apiBase}${media.downloadUrl}` : media.downloadUrl;
      const asset={assetId:upload.assetId,url:resolvedMediaUrl,filename};
      setRenderedAsset({signature,asset});
      return asset;
    } finally {setIsPreparingVisual(false);}
  }

  async function handleRemoveBackground() {
    if (!generatedAsset?.assetId) return;

    try {
      setIsRemovingBg(true);
      const res = await clipdropApi.removeBackground(generatedAsset.assetId);
      setGeneratedAsset((prev) =>
        prev
          ? {
              ...prev,
              assetId: res.assetId,
              url: res.url,
              filename: res.filename,
              remainingCredits: res.remainingCredits ?? prev.remainingCredits,
            }
          : null
      );
      toast.success("Background removed cleanly with Clipdrop AI!");

      if (onAttach) {
        onAttach({
          assetId: res.assetId,
          url: res.url,
          filename: res.filename,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to remove background.");
    } finally {
      setIsRemovingBg(false);
    }
  }

  async function handleAttachToPost() {
    if (!generatedAsset) {
      toast.error("Generate an image first.");
      return;
    }

    try {
      const asset=await visualAssetForPost();
      onAttach?.(asset);
      setIsAttached(true);
      toast.success('Visual attached to your post.');
      if(composerMode)onClose();
    } catch(error) {toast.error((error as Error).message);}
  }

  async function handleSavePostToLibrary() {
    if (!generatedAsset) {
      toast.error("Generate an image first.");
      return;
    }

    try {
      setIsSavingPost(true);
      const asset=await visualAssetForPost();
      const res = await clipdropApi.attachAndSave({
        contentId: savedPostId || undefined,
        title: headline.trim() || initialTitle || "AI Studio Generated Post",
        body: postCaption.trim() || initialContentText || headline.trim(),
        platforms: [targetPlatform],
        assetId: asset.assetId,
        mediaUrl: asset.url,
        status: "NEEDS_REVIEW",
      });

      setSavedPostId(res.id);
      setIsAttached(true);
      toast.success("Post & Visual saved to Content Library (Status: Needs Review)!");

      if (onAttach) {
        onAttach({
          assetId: asset.assetId,
          url: asset.url,
          filename: asset.filename,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save post to library.");
    } finally {
      setIsSavingPost(false);
    }
  }

  function toggleAccountSelection(accId: string) {
    setSelectedSocialAccountIds((prev) =>
      prev.includes(accId) ? prev.filter((id) => id !== accId) : [...prev, accId]
    );
  }

  function selectAllAccounts() {
    setSelectedSocialAccountIds(connectedAccounts.map((a) => a.id));
  }

  function deselectAllAccounts() {
    setSelectedSocialAccountIds([]);
  }

  async function handlePublishDirectly() {
    if (!generatedAsset) {
      toast.error("Please generate an image first.");
      return;
    }

    if (targetAccounts.length === 0) {
      toast.error("Please select at least one connected social account to publish to.");
      return;
    }

    try {
      setIsPublishing(true);
      const asset=await visualAssetForPost();

      // Safe non-empty caption / body
      const bodyToPublish =
        postCaption.trim() ||
        prompt.trim() ||
        headline.trim() ||
        initialContentText?.trim() ||
        "Visual generated with ContentOS AI Studio";

      const titleToPublish =
        headline.trim() ||
        initialTitle?.trim() ||
        (prompt ? prompt.slice(0, 60).trim() : "") ||
        "AI Studio Visual Post";

      const targetPlatforms = Array.from(
        new Set(targetAccounts.map((a) => a.platform))
      );

      // 1. Ensure post is saved in database first with all target platforms
      const saveRes = await clipdropApi.attachAndSave({
        contentId: savedPostId || undefined,
        title: titleToPublish,
        body: bodyToPublish,
        platforms: targetPlatforms,
        assetId: asset.assetId,
        mediaUrl: asset.url,
        status: "NEEDS_REVIEW",
      });

      setSavedPostId(saveRes.id);

      // 2. Publish to all selected social accounts
      const results: { account: Account; success: boolean; status?: string; postId?: string; error?: string }[] = [];
      setPublishResults([]);
      setPublishedInfo(null);

      for (const acc of targetAccounts) {
        if (acc.platform.toLowerCase() === "youtube") {
          results.push({
            account: acc,
            success: false,
            status: 'skipped',
            error: "YouTube only supports video uploads (images not supported)",
          });
          continue;
        }

        try {
          const response = await clipdropApi.publishPost(saveRes.id, acc.id);
          const confirmed = response.success === true && Boolean(response.providerPostId);
          results.push({ account: acc, success: confirmed, status: confirmed ? 'success' : response.status === 'skipped' ? 'skipped' : 'failure',postId:response.providerPostId,error:confirmed?undefined:response.error || 'Provider did not confirm publication with a post ID.' });
        } catch (pubErr: any) {
          results.push({
            account: acc,
            success: false,
            error: pubErr?.message || "Publish request failed",
          });
        }
      }

      const succeeded = results.filter((r) => r.success);
      setPublishResults(results.map(r=>({platform:r.account.platform,status:r.status || 'failure',postId:r.postId,error:r.error})));
      const failed = results.filter((r) => !r.success);

      if (succeeded.length > 0) {
        const channelNames = succeeded
          .map((r) => `${r.account.platform} (${r.account.name})`)
          .join(", ");

        setPublishedInfo({
          channel: channelNames,
          at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        });

        if (failed.length === 0) {
          toast.success(`🎉 Successfully published to: ${channelNames}!`);
        } else {
          toast.success(`Published to: ${channelNames}!`);
          const failedDetails = failed.map((f) => `${f.account.platform}: ${f.error}`).join(" | ");
          toast.info(`Note on skipped channels: ${failedDetails}`);
        }
      } else {
        const failedDetails = failed.map((f) => `${f.account.platform}: ${f.error}`).join(" | ");
        toast.error(`Publishing failed: ${failedDetails}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Publishing failed. Please check connected account tokens.");
    } finally {
      setIsPublishing(false);
    }
  }



  return (
    <ModalFrame open={isOpen} onClose={onClose} title="AI Visual Studio" className="visual-dialog">
      <div
        style={{
          width: "100%",
          maxWidth: "1060px",
          maxHeight: "92vh",
          backgroundColor: "var(--surface)",
          border: "1px solid rgba(99, 102, 241, 0.35)",
          borderRadius: "20px",
          boxShadow: "0 30px 60px -15px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.15)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(90deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.08), transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #6366f1, #a855f7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink)",
                boxShadow: "0 4px 14px rgba(99, 102, 241, 0.4)",
              }}
            >
              <Wand2 size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.01em" }}>
                  AI Visual Studio & Brand Canvas
                </h3>
                <span
                  style={{
                    background: "rgba(99, 102, 241, 0.2)",
                    border: "1px solid rgba(99, 102, 241, 0.4)",
                    color: "var(--accent)",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "20px",
                  }}
                >
                  {composerMode ? 'Create Post' : targetPlatform}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                {composerMode ? `${attachmentLabel}. Generate a visual, then return to Create Post to review and publish.` : 'Generate visuals, customize brand overlays, and publish to your connected channels.'}
              </p>
            </div>
          </div>

          {/* Engine Selector Header Pills */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "3px",
                display: "flex",
                gap: "4px",
              }}
            >
              <button
                type="button"
                onClick={() => setEngine("clipdrop")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "7px",
                  border: "none",
                  background: engine === "clipdrop" ? "linear-gradient(135deg, #6366f1, #4f46e5)" : "transparent",
                  color: engine === "clipdrop" ? "#fff" : "var(--muted)",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.2s",
                }}
              >
                <Zap size={13} style={{ color: engine === "clipdrop" ? "var(--accent)" : "var(--muted)" }} />
                Clipdrop (SDXL)
                {generatedAsset?.remainingCredits !== undefined && generatedAsset.remainingCredits !== null && (
                  <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>({generatedAsset.remainingCredits})</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setEngine("flux")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "7px",
                  border: "none",
                  background: engine === "flux" ? "linear-gradient(135deg, #10b981, #059669)" : "transparent",
                  color: engine === "flux" ? "#fff" : "var(--muted)",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.2s",
                }}
              >
                <Sparkles size={13} style={{ color: engine === "flux" ? "#a7f3d0" : "var(--muted)" }} />
                FLUX.1 Pro (Free)
              </button>
            </div>

            <button
              onClick={onClose}
              aria-label="Close AI Visual Studio"
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "8px",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body Grid */}
        <div className="visual-studio-grid" style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", flex: 1, overflowY: "auto" }}>
          {/* Controls Column */}
          <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px", borderRight: "1px solid var(--border)" }}>
            
            {/* Visual Prompt Input */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Wand2 size={15} style={{ color: "var(--accent)" }} /> Visual Prompt
                </label>
                <button
                  type="button"
                  onClick={handleSuggestPrompt}
                  disabled={isSuggesting}
                  style={{
                    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))",
                    color: "var(--accent)",
                    border: "1px solid rgba(168, 85, 247, 0.4)",
                    padding: "5px 12px",
                    borderRadius: "8px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    cursor: isSuggesting ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {isSuggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  ✨ AI Magic Prompt from Post
                </button>
              </div>

              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Futuristic minimalist 3D workspace with glowing holographic graphs, floating glass cubes, sleek studio lighting..."
                style={{
                  width: "100%",
                  background: "var(--surface2)",
                  border: "1px solid rgba(99, 102, 241, 0.25)",
                  borderRadius: "10px",
                  padding: "12px",
                  color: "var(--ink)",
                  fontSize: "0.88rem",
                  lineHeight: "1.45",
                  outline: "none",
                  resize: "vertical",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                }}
              />
            </div>

            {/* Style Presets */}
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--muted)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Palette size={14} style={{ color: "var(--accent)" }} /> Visual Art Style Preset
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
                {[
                  { id: "3d-render", label: "3D Glass", emoji: "🎨" },
                  { id: "cinematic", label: "Cinematic", emoji: "📸" },
                  { id: "minimal-saas", label: "SaaS Minimal", emoji: "💼" },
                  { id: "cyberpunk", label: "Cyberpunk", emoji: "🌌" },
                  { id: "editorial", label: "Editorial", emoji: "🖌️" },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStylePreset(s.id)}
                    style={{
                      padding: "8px 4px",
                      borderRadius: "8px",
                      border: stylePreset === s.id ? "1.5px solid #818cf8" : "1px solid var(--border)",
                      background: stylePreset === s.id ? "rgba(99, 102, 241, 0.25)" : "var(--surface2)",
                      color: stylePreset === s.id ? "var(--accent)" : "var(--muted)",
                      fontSize: "0.76rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "center",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "3px",
                      transition: "all 0.2s",
                    }}
                  >
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio Presets */}
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--muted)", marginBottom: "8px", display: "block" }}>
                Target Aspect Ratio
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                {[
                  { ratio: "1:1", label: "1:1 Square", sub: "LinkedIn / Feed" },
                  { ratio: "4:5", label: "4:5 Portrait", sub: "Portrait feed" },
                  { ratio: "16:9", label: "16:9 Landscape", sub: "Wide artwork" },
                  { ratio: "9:16", label: "9:16 Vertical", sub: "Vertical artwork" },
                ].map((item) => (
                  <button
                    key={item.ratio}
                    type="button"
                    onClick={() => setAspectRatio(item.ratio as any)}
                    style={{
                      padding: "10px 8px",
                      borderRadius: "10px",
                      border: aspectRatio === item.ratio ? "2px solid #6366f1" : "1px solid var(--border)",
                      background: aspectRatio === item.ratio ? "rgba(99, 102, 241, 0.25)" : "var(--surface2)",
                      color: aspectRatio === item.ratio ? "var(--accent)" : "var(--muted)",
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontSize: "0.84rem" }}>{item.label}</div>
                    <div style={{ fontSize: "0.68rem", opacity: 0.7 }}>{item.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt Quick Inspiration Pills (ChatGPT / Midjourney style) */}
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--muted)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={14} style={{ color: "var(--warning)" }} /> Quick Inspiration
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[
                  { label: "🦉 Living Being / Animal", example: "A majestic owl with piercing glowing red eyes perched on a mossy ancient branch, cinematic studio lighting" },
                  { label: "🪔 Festival Poster", example: "Happy Diwali festival celebration poster with company name Palak Private Limited, glowing clay diyas and golden lights" },
                  { label: "🚗 Modern Object", example: "Sleek aerodynamic cyberpunk sports car drifting through wet neon Tokyo streets at midnight" },
                  { label: "🏔️ Nature Landscape", example: "Breathtaking mountain waterfall with double rainbow arching over turquoise canyon lake at golden hour" },
                  { label: "🏙️ Cyberpunk City", example: "Futuristic neon-lit megacity skyline with flying vehicles and glowing holographic billboards" },
                  { label: "💼 SaaS 3D Icon", example: "Clean minimalist 3D glass isometric cube floating with glowing holographic AI nodes and data flows" },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(item.example)}
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      color: "var(--ink)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(99, 102, 241, 0.18)";
                      e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.4)";
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                      e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
                      e.currentTarget.style.color = "#cbd5e1";
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Generation Button */}
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={isGenerating}
              style={{
                marginTop: "auto",
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: engine === "flux"
                  ? "linear-gradient(135deg, #10b981, #059669)"
                  : "linear-gradient(135deg, #6366f1, #4f46e5)",
                color: "var(--ink)",
                fontWeight: 700,
                fontSize: "0.98rem",
                cursor: isGenerating ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                boxShadow: "0 8px 20px -4px rgba(99, 102, 241, 0.4)",
                transition: "all 0.2s",
              }}
            >
              {isGenerating ? <Loader2 size={20} className="animate-spin" /> : <Zap size={20} />}
              {isGenerating
                ? `Generating with ${engine === "flux" ? "FLUX.1 Pro" : "Clipdrop AI"}...`
                : `Generate Visual with ${engine === "flux" ? "FLUX.1 Pro (Free)" : "Clipdrop AI"}`}
            </button>
          </div>

          {/* Right Column: Live Visual Canvas & Actions */}
          {/* Right Column: Ultra-Premium Studio Visual Canvas & Actions */}
          <div
            style={{
              padding: "24px",
              background: "linear-gradient(180deg, var(--surface2) 0%, var(--surface2) 100%)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              overflowY: "auto",
            }}
          >
            {/* Top Studio Control & Typography Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "0.88rem", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.2px" }}>
                  Studio Canvas
                </span>

                {/* Dynamic Status / Mode Badge */}
                {enableBrandOverlay && (headline || logoText) ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--warning)", background: "rgba(251, 191, 36, 0.15)", border: "1px solid rgba(251, 191, 36, 0.3)", padding: "3px 8px", borderRadius: "6px" }}>
                      ✨ {headline || logoText} Poster
                    </span>
                    <button
                      type="button"
                      onClick={() => setEnableBrandOverlay(!enableBrandOverlay)}
                      style={{
                        fontSize: "0.72rem",
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--muted)",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      {enableBrandOverlay ? "View Clean Art" : "View Poster"}
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--muted)", background: "var(--border)", border: "1px solid var(--border)", padding: "3px 8px", borderRadius: "6px" }}>
                    🖼️ AI Visual
                  </span>
                )}
              </div>

              {/* Quick Canvas Utilities */}
              {generatedAsset && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={handleCopyImage}
                    title="Copy image to clipboard"
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "7px",
                      padding: "5px 9px",
                      color: copiedImage ? "var(--success)" : "#cbd5e1",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      transition: "all 0.2s",
                    }}
                  >
                    {copiedImage ? <CheckCheck size={13} /> : <Copy size={13} />}
                    {copiedImage ? "Copied" : "Copy"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsFullscreenZoom(true)}
                    title="Fullscreen zoom"
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "7px",
                      padding: "5px 8px",
                      color: "var(--ink)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Maximize2 size={13} />
                  </button>

                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "var(--muted)",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      padding: "4px 8px",
                      borderRadius: "6px",
                    }}
                  >
                    {aspectRatio} · UHD
                  </span>
                </div>
              )}
            </div>



            {/* Visual Canvas Display Viewport */}
            <style>{`
              @keyframes chatgptShimmer {
                0% { left: -120%; }
                100% { left: 220%; }
              }
              @keyframes chatgptBarFlow {
                0% { background-position: 0% 0%; }
                100% { background-position: 200% 0%; }
              }
              @keyframes pulseLaserGlow {
                0%, 100% { filter: drop-shadow(0 0 10px rgba(129, 140, 248, 0.4)); }
                50% { filter: drop-shadow(0 0 25px rgba(168, 85, 247, 0.8)); }
              }
            `}</style>

            <div
              style={{
                width: "100%",
                borderRadius: "16px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                minHeight: "370px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
                boxShadow: isGenerating
                  ? "0 0 35px rgba(99, 102, 241, 0.25), inset 0 0 30px rgba(0,0,0,0.9)"
                  : "0 10px 30px rgba(0,0,0,0.5), inset 0 0 20px rgba(0,0,0,0.8)",
              }}
            >
              {isGenerating ? (
                /* 🌟 Ultra-Premium SaaS Generative Studio Animation Canvas */
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    minHeight: "370px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "36px 20px",
                    position: "relative",
                    background: "radial-gradient(ellipse at 50% 30%, rgba(99, 102, 241, 0.2) 0%, var(--surface2) 65%, var(--surface) 100%)",
                    overflow: "hidden",
                  }}
                >
                  {/* Dynamic Shimmer Light Beam */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "-120%",
                      width: "60%",
                      height: "100%",
                      background: "linear-gradient(90deg, transparent, var(--surface2), rgba(129, 140, 248, 0.25), transparent)",
                      transform: "skewX(-25deg)",
                      animation: "chatgptShimmer 2.2s infinite ease-in-out",
                      pointerEvents: "none",
                    }}
                  />

                  {/* Top Status Header */}
                  <div
                    style={{
                      position: "absolute",
                      top: "14px",
                      left: "14px",
                      right: "14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        background: "var(--surface2)",
                        border: "1px solid rgba(99, 102, 241, 0.4)",
                        borderRadius: "20px",
                        padding: "5px 12px",
                        backdropFilter: "blur(10px)",
                      }}
                    >
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: "#10b981",
                          boxShadow: "0 0 10px #10b981",
                          display: "inline-block",
                        }}
                      />
                      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--ink)" }}>
                        Neural Studio Active
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: "var(--muted)",
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        padding: "4px 10px",
                        borderRadius: "12px",
                        backdropFilter: "blur(8px)",
                      }}
                    >
                      {engine === "flux" ? "FLUX.1 Pro Engine" : "Clipdrop SDXL Engine"} · {aspectRatio}
                    </span>
                  </div>

                  {/* Center Holographic AI Studio Core */}
                  <div
                    style={{
                      position: "relative",
                      width: "120px",
                      height: "120px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                      marginTop: "16px",
                    }}
                  >
                    {/* Outer Orbit */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        border: "2px dashed rgba(129, 140, 248, 0.45)",
                        animation: "spin 10s linear infinite",
                      }}
                    />
                    {/* Pulsing Aura */}
                    <div
                      style={{
                        position: "absolute",
                        inset: "10px",
                        borderRadius: "50%",
                        background: "radial-gradient(circle, rgba(168, 85, 247, 0.4) 0%, rgba(99, 102, 241, 0.25) 70%, transparent 100%)",
                        filter: "blur(14px)",
                      }}
                    />
                    {/* Core Sphere */}
                    <div
                      style={{
                        position: "relative",
                        width: "80px",
                        height: "80px",
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, var(--surface2), var(--surface2))",
                        border: "1.5px solid rgba(168, 85, 247, 0.6)",
                        boxShadow: "0 0 30px rgba(99, 102, 241, 0.5), inset 0 0 16px rgba(168, 85, 247, 0.4)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Sparkles
                        size={28}
                        style={{
                          color: generationSteps[generationStep].color,
                          filter: `drop-shadow(0 0 10px ${generationSteps[generationStep].color})`,
                        }}
                      />
                      <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                        {generationPercent}%
                      </span>
                    </div>
                  </div>

                  {/* Step Progression Headline & Subtitle */}
                  <div style={{ textAlign: "center", maxWidth: "340px", marginBottom: "14px" }}>
                    <div
                      style={{
                        fontSize: "0.96rem",
                        fontWeight: 700,
                        color: "var(--ink)",
                        marginBottom: "4px",
                        letterSpacing: "-0.2px",
                      }}
                    >
                      {generationSteps[generationStep].title}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: "1.4" }}>
                      {generationSteps[generationStep].subtitle}
                    </div>
                  </div>

                  {/* Flowing Laser Progress Bar */}
                  <div
                    style={{
                      width: "250px",
                      height: "6px",
                      background: "var(--surface2)",
                      borderRadius: "10px",
                      overflow: "hidden",
                      position: "relative",
                      marginBottom: "14px",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        height: "100%",
                        width: `${generationPercent}%`,
                        background: "linear-gradient(90deg, #6366f1, #a855f7, #38bdf8, #6366f1)",
                        backgroundSize: "200% 100%",
                        animation: "chatgptBarFlow 1.6s linear infinite",
                        borderRadius: "10px",
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>

                  {/* Detected Entity Chips */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center", maxWidth: "340px" }}>
                    {logoText && (
                      <span style={{ background: "rgba(245, 158, 11, 0.15)", border: "1px solid rgba(245, 158, 11, 0.3)", color: "#fcd34d", fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "10px" }}>
                        🏛️ {logoText}
                      </span>
                    )}
                    {headline && (
                      <span style={{ background: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.3)", color: "var(--accent)", fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "10px" }}>
                        ✨ {headline}
                      </span>
                    )}
                  </div>
                </div>
              ) : generatedAsset ? (
                /* 🖼️ High-Res Generated Visual Canvas */
                <>
                  <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <img
                      src={generatedAsset.url}
                      alt="Generated Visual"
                      onLoad={() => setImageLoaded(true)}
                      onError={() => setImageError(true)}
                      style={{
                        width: "100%",
                        height: "auto",
                        maxHeight: "410px",
                        display: "block",
                        objectFit: "contain",
                        transition: "opacity 0.3s ease",
                        opacity: imageLoaded ? 1 : 0.85,
                        borderRadius: "12px",
                      }}
                    />

                    {/* ✨ Floating Glassmorphic Brand Overlay & Greetings (Rendered strictly when enabled and content exists) */}
                    {enableBrandOverlay && (Boolean(logoText) || Boolean(headline) || Boolean(subtitle)) && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          padding: "16px",
                          pointerEvents: "none",
                        }}
                      >
                        {/* Top Floating Glass Badge: Company Name */}
                        {logoText ? (
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <div
                              style={{
                                background: "var(--surface2)",
                                backdropFilter: "blur(12px)",
                                border: "1px solid var(--border-strong)",
                                borderRadius: "30px",
                                padding: "6px 20px",
                                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <Sparkles size={14} style={{ color: "var(--warning)" }} />
                              <span
                                style={{
                                  fontSize: "0.82rem",
                                  fontWeight: 800,
                                  color: "var(--ink)",
                                  letterSpacing: "1px",
                                  textTransform: "uppercase",
                                }}
                              >
                                {logoText}
                              </span>
                              <Sparkles size={14} style={{ color: "var(--warning)" }} />
                            </div>
                          </div>
                        ) : <div />}

                        {/* Bottom Floating Glass Card: Dynamic Headline & Subtitle */}
                        {(Boolean(headline) || Boolean(subtitle)) && (
                          <div
                            style={{
                              background: "rgba(8, 12, 24, 0.88)",
                              backdropFilter: "blur(14px)",
                              border: "1px solid rgba(251, 191, 36, 0.38)",
                              borderRadius: "14px",
                              padding: "12px 18px",
                              textAlign: "center",
                              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.7)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                            }}
                          >
                            {headline && (
                              <div
                                style={{
                                  fontSize: "1.2rem",
                                  fontWeight: 900,
                                  fontFamily: "Georgia, serif",
                                  color: "#fef08a",
                                  letterSpacing: "0.5px",
                                  textShadow: "0 2px 8px rgba(234, 179, 8, 0.5)",
                                }}
                              >
                                {headline}
                              </div>
                            )}
                            {subtitle && (
                              <div style={{ fontSize: "0.75rem", color: "var(--ink)", lineHeight: "1.3" }}>
                                {subtitle}
                              </div>
                            )}
                            {logoText && (
                              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--muted)", marginTop: "2px" }}>
                                Warm Greetings from {logoText}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Error Recovery Card */}
                  {imageError && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "var(--surface)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "20px",
                        textAlign: "center",
                      }}
                    >
                      <ImageIcon size={44} style={{ color: "var(--danger)", marginBottom: "8px" }} />
                      <p style={{ color: "var(--ink)", fontWeight: 700, margin: 0, fontSize: "0.92rem" }}>
                        Visual Preview Needs Refresh
                      </p>
                      <p style={{ color: "var(--muted)", fontSize: "0.78rem", margin: "4px 0 14px", maxWidth: "280px" }}>
                        The visual file is saved. Click below to reload the image buffer.
                      </p>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setImageError(false);
                            setImageLoaded(false);
                          }}
                          style={{
                            padding: "7px 14px",
                            borderRadius: "8px",
                            background: "#6366f1",
                            color: "var(--ink)",
                            border: "none",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Reload Image
                        </button>
                        <a
                          href={generatedAsset.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: "7px 14px",
                            borderRadius: "8px",
                            background: "var(--surface2)",
                            color: "var(--ink)",
                            textDecoration: "none",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          Open Direct URL
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Engine Tag */}
                  <div
                    style={{
                      position: "absolute",
                      top: "12px",
                      left: "12px",
                      display: "flex",
                      gap: "6px",
                      zIndex: 10,
                    }}
                  >
                    <span
                      style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--ink)",
                        fontSize: "0.72rem",
                        padding: "3px 8px",
                        borderRadius: "8px",
                        fontWeight: 700,
                        backdropFilter: "blur(6px)",
                      }}
                    >
                      {generatedAsset.engine === "flux" ? "FLUX.1 Pro" : "Clipdrop SDXL"}
                    </span>
                  </div>

                  {/* Credits Tag */}
                  {generatedAsset.remainingCredits !== null && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: "12px",
                        right: "12px",
                        background: "var(--surface2)",
                        border: "1px solid rgba(52, 211, 153, 0.4)",
                        color: "var(--success)",
                        fontSize: "0.72rem",
                        padding: "3px 10px",
                        borderRadius: "12px",
                        fontWeight: 700,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
                        zIndex: 10,
                      }}
                    >
                      Credits: {generatedAsset.remainingCredits}
                    </span>
                  )}
                </>
              ) : (
                <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 20px" }}>
                  <ImageIcon size={52} style={{ opacity: 0.35, marginBottom: "12px", margin: "0 auto" }} />
                  <p style={{ margin: 0, fontSize: "0.92rem", fontWeight: 600, color: "var(--muted)" }}>
                    No visual generated yet
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                    Choose your style, click "Generate Visual", and preview your post visual here.
                  </p>
                </div>
              )}
            </div>

            {/* SaaS Studio Power Action Suite */}
            {generatedAsset && (
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleDownloadImage}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "none",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    color: "var(--ink)",
                    fontSize: "0.84rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    boxShadow: "0 4px 14px rgba(16, 185, 129, 0.3)",
                    transition: "all 0.2s",
                  }}
                >
                  <Download size={15} />
                  {enableBrandOverlay ? "Download Branded Poster (PNG)" : "Download Image (PNG)"}
                </button>

                <button
                  type="button"
                  onClick={handleRemoveBackground}
                  disabled={isRemovingBg}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(168, 85, 247, 0.4)",
                    background: "rgba(168, 85, 247, 0.15)",
                    color: "#d8b4fe",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: isRemovingBg ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  {isRemovingBg ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
                  Cutout / No BG
                </button>

                <button
                  type="button"
                  onClick={() => handleGenerate(true)}
                  disabled={isGenerating}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--surface2)",
                    color: "var(--ink)",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: isGenerating ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <RefreshCw size={13} />
                  Variation
                </button>
              </div>
            )}

            {composerMode && generatedAsset && <div className="panel" style={{padding:16}}>
              <strong>{attachmentLabel}</strong>
              <p>This image will use your caption and selected channels in Create Post. Review and publish there.</p>
              <button type="button" className="button primary" disabled={isPreparingVisual} onClick={handleAttachToPost}>{isPreparingVisual ? 'Preparing image…' : 'Use image & return to post'}</button>
            </div>}
            {/* Standalone studio retains its existing publishing actions. */}
            {generatedAsset && !composerMode && (
              <div
                style={{
                  background: "var(--surface2)",
                  borderRadius: "14px",
                  border: "1px solid rgba(99, 102, 241, 0.25)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <Share2 size={15} style={{ color: "var(--accent)" }} />
                    Publishing & Post Actions
                  </span>
                  {isAttached && (
                    <span style={{ fontSize: "0.72rem", color: "var(--success)", display: "flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                      <CheckCircle2 size={13} /> Attached to Draft
                    </span>
                  )}
                </div>

                {/* Primary Action Buttons */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={handleAttachToPost}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "9px",
                      border: "1px solid rgba(99, 102, 241, 0.5)",
                      background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                      color: "#e0e7ff",
                      fontSize: "0.84rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                    }}
                  >
                    <Check size={14} />
                    Attach to Studio Draft
                  </button>

                  <button
                    type="button"
                    onClick={handleSavePostToLibrary}
                    disabled={isSavingPost}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "9px",
                      border: "1px solid rgba(52, 211, 153, 0.4)",
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "var(--success)",
                      fontSize: "0.84rem",
                      fontWeight: 700,
                      cursor: isSavingPost ? "wait" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                    }}
                  >
                    {isSavingPost ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                    Save to Content Library
                  </button>
                </div>

                {/* 1-Click Multi-Account Social Channel Publishing */}
                <div
                  style={{
                    background: "var(--surface2)",
                    borderRadius: "12px",
                    padding: "14px",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label style={{ fontSize: "0.82rem", color: "var(--ink)", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                      <Globe size={15} style={{ color: "var(--accent)" }} />
                      Publish Directly to Social Accounts
                    </label>
                    {connectedAccounts.length > 0 && (
                      <span style={{ fontSize: "0.72rem", color: "var(--accent)", background: "rgba(56, 189, 248, 0.12)", padding: "2px 8px", borderRadius: "20px", fontWeight: 600, border: "1px solid rgba(56, 189, 248, 0.25)" }}>
                        {targetAccounts.length} of {connectedAccounts.length} selected
                      </span>
                    )}
                  </div>

                  {/* Post Caption / Text Input */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.74rem", color: "var(--muted)", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                        <Edit3 size={11} style={{ color: "var(--accent)" }} />
                        Post Caption / Message
                      </label>
                      <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                        Published along with image
                      </span>
                    </div>
                    <textarea
                      value={postCaption}
                      onChange={(e) => {
                        setPostCaption(e.target.value);
                        setCaptionManuallyEdited(true);
                      }}
                      placeholder="Write the caption or message to accompany this visual..."
                      rows={2}
                      style={{
                        width: "100%",
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        color: "var(--ink)",
                        fontSize: "0.8rem",
                        lineHeight: "1.4",
                        resize: "none",
                        outline: "none",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  {connectedAccounts.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {/* Selection Toolbar */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600 }}>
                          Select Accounts to Publish Simultaneously:
                        </span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            onClick={selectAllAccounts}
                            style={{
                              fontSize: "0.68rem",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              background: "rgba(56, 189, 248, 0.15)",
                              color: "var(--accent)",
                              border: "1px solid rgba(56, 189, 248, 0.3)",
                              cursor: "pointer",
                              fontWeight: 600,
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={deselectAllAccounts}
                            style={{
                              fontSize: "0.68rem",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              background: "var(--surface2)",
                              color: "var(--muted)",
                              border: "1px solid var(--border)",
                              cursor: "pointer",
                              fontWeight: 500,
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      {/* Accounts Cards List */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          maxHeight: "160px",
                          overflowY: "auto",
                          paddingRight: "2px",
                        }}
                      >
                        {connectedAccounts.map((acc) => {
                          const isSelected = selectedSocialAccountIds.includes(acc.id);
                          const isYouTube = acc.platform.toLowerCase() === "youtube";
                          const isTelegram = acc.platform.toLowerCase() === "telegram";
                          const isLinkedIn = acc.platform.toLowerCase() === "linkedin";

                          const badgeBg = isTelegram
                            ? "rgba(14, 165, 233, 0.18)"
                            : isLinkedIn
                            ? "rgba(59, 130, 246, 0.18)"
                            : isYouTube
                            ? "rgba(239, 68, 68, 0.18)"
                            : "rgba(168, 85, 247, 0.18)";

                          const badgeColor = isTelegram
                            ? "#38bdf8"
                            : isLinkedIn
                            ? "#60a5fa"
                            : isYouTube
                            ? "#f87171"
                            : "#c084fc";

                          return (
                            <div
                              key={acc.id}
                              onClick={() => toggleAccountSelection(acc.id)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 10px",
                                borderRadius: "8px",
                                background: isSelected
                                  ? "linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(139, 92, 246, 0.1))"
                                  : "rgba(15, 23, 42, 0.55)",
                                border: isSelected
                                  ? "1px solid rgba(56, 189, 248, 0.6)"
                                  : "1px solid rgba(255, 255, 255, 0.08)",
                                cursor: "pointer",
                                transition: "all 0.18s ease",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}} // controlled via div onClick
                                  style={{
                                    accentColor: "#38bdf8",
                                    cursor: "pointer",
                                    width: "15px",
                                    height: "15px",
                                  }}
                                />
                                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "nowrap" }}>
                                    <span
                                      style={{
                                        fontSize: "0.8rem",
                                        fontWeight: 600,
                                        color: isSelected ? "#fff" : "#cbd5e1",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        maxWidth: "180px",
                                      }}
                                      title={acc.name}
                                    >
                                      {acc.name}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: "0.64rem",
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        textTransform: "uppercase",
                                        fontWeight: 700,
                                        letterSpacing: "0.3px",
                                        background: badgeBg,
                                        color: badgeColor,
                                        border: `1px solid ${badgeColor}33`,
                                      }}
                                    >
                                      {acc.platform}
                                    </span>
                                  </div>
                                  {isYouTube && (
                                    <span style={{ fontSize: "0.67rem", color: "var(--danger)", marginTop: "1px" }}>
                                      (Note: YouTube only supports video uploads)
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                {isSelected ? (
                                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px", borderRadius: "50%", background: "#38bdf8", color: "var(--ink)" }}>
                                    <Check size={11} strokeWidth={3} />
                                  </span>
                                ) : (
                                  <span style={{ width: "18px", height: "18px", borderRadius: "50%", border: "1px solid var(--border-strong)" }} />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Publish Button */}
                      <button
                        type="button"
                        onClick={handlePublishDirectly}
                        disabled={isPublishing || targetAccounts.length === 0}
                        style={{
                          width: "100%",
                          padding: "10px 16px",
                          borderRadius: "9px",
                          border: "none",
                          background:
                            targetAccounts.length === 0
                              ? "rgba(255, 255, 255, 0.08)"
                              : "linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%)",
                          color: targetAccounts.length === 0 ? "#64748b" : "#fff",
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          cursor: isPublishing
                            ? "wait"
                            : targetAccounts.length === 0
                            ? "not-allowed"
                            : "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          boxShadow:
                            targetAccounts.length > 0
                              ? "0 4px 16px rgba(236, 72, 153, 0.35)"
                              : "none",
                          transition: "all 0.2s ease",
                          marginTop: "2px",
                        }}
                      >
                        {isPublishing ? (
                          <>
                            <Loader2 size={15} className="animate-spin" />
                            Publishing to {targetAccounts.length} Accounts...
                          </>
                        ) : (
                          <>
                            <Send size={15} />
                            🚀 Publish to {targetAccounts.length} Selected Account{targetAccounts.length === 1 ? "" : "s"}
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "6px", padding: "6px 0" }}>
                      <span>No social channel connected yet.</span>
                      <a href="/app/manage" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                        Connect in Settings →
                      </a>
                    </div>
                  )}

                  {publishResults.length > 0 && <ul aria-label="Channel publishing results">
                    {publishResults.map((result,index)=><li key={index}>{result.platform}: {result.status}{result.postId && <> — Post ID: {result.postId}</>}{result.error && <> — {result.error}</>}</li>)}
                  </ul>}
                  {publishedInfo && (
                    <div
                      style={{
                        background: "rgba(16, 185, 129, 0.15)",
                        border: "1px solid rgba(16, 185, 129, 0.35)",
                        borderRadius: "8px",
                        padding: "9px 12px",
                        fontSize: "0.78rem",
                        color: "var(--success)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                      <div>
                        Post & visual published to <strong>{publishedInfo.channel}</strong> at {publishedInfo.at}!
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Fullscreen Lightbox Zoom Modal */}
          {isFullscreenZoom && generatedAsset && (
            <ModalFrame open={isFullscreenZoom} onClose={()=>setIsFullscreenZoom(false)} title="Fullscreen image preview" className="fullscreen-dialog">
            <div
              onClick={() => setIsFullscreenZoom(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.92)",
                zIndex: 99999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px",
                backdropFilter: "blur(8px)",
              }}
            >
              <button
                type="button"
                aria-label="Close fullscreen preview"
                onClick={() => setIsFullscreenZoom(false)}
                style={{
                  position: "absolute",
                  top: "24px",
                  right: "24px",
                  background: "var(--surface2)",
                  border: "none",
                  borderRadius: "50%",
                  width: "40px",
                  height: "40px",
                  color: "var(--ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
              <img
                src={generatedAsset.url}
                alt="Fullscreen Preview"
                style={{
                  maxWidth: "90vw",
                  maxHeight: "90vh",
                  objectFit: "contain",
                  borderRadius: "12px",
                  boxShadow: "0 25px 60px rgba(0,0,0,0.8)",
                }}
              />
            </div>
            </ModalFrame>
          )}
        </div>
      </div>
    </ModalFrame>
  );
};
