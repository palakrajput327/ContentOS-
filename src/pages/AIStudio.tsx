import React, { useState, useEffect,useRef } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles,
  FileText,
  Upload,
  Layers,
  Check,
  RotateCw,
  Save,
  Send,
  AlertCircle,
  FileCheck,
  Quote,
  Sliders,
  CheckSquare,
  Square,
  HelpCircle,
  ChevronRight,
  ExternalLink,
  BookOpen,
  Info,
  Clock,
  ThumbsUp,
  MessageSquare,
  Share2,
  Trash2,
  Wand2,
  ArrowUpRight,
  Copy,
  History,
  Eye,
  Pencil,
  Palette,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge } from "../components/ui";
import { platforms, type Platform, type Snapshot } from "../lib/model";
import { data, request, documentsApi, clipdropApi, resolveMediaUrl, type DocItem, type KnowledgeItem, type DocumentBrandIdentity } from "../lib/api";
import { useSession } from "../lib/session";
import { PublishPreviewModal } from "../components/PublishPreviewModal";
import { ClipdropImageModal } from "../components/ClipdropImageModal";
import { BatchProgressIndicator } from "../components/BatchProgressIndicator";
import KnowledgeAutomation from './KnowledgeAutomation';
import { DocumentVisualConceptsHub } from '../components/DocumentVisualConceptsHub';
import { BrandIdentityModal } from '../components/BrandIdentityModal';
import { LiveAutoPilotPulse } from '../components/LiveAutoPilotPulse';
import './studio-integration.css';

function formatExcerpt(text: string | null | undefined): string {
  if (!text) return "";
  const clean = text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gi, "")
    .replace(/\b[a-zA-Z0-9-]+\.(?:tk|com|net|org|in|io)\b/gi, "")
    .replace(/\[Page\s*\d+\]/gi, "")
    .replace(/[-_=|~]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = clean.split(/\s+/).filter((w) => w.length >= 3 && /^[a-zA-Z0-9]+$/.test(w));
  if (words.length < 3) return "";

  return clean.length > 160 ? clean.substring(0, 160) + "..." : clean;
}
function visualEvidence(item:KnowledgeItem) {
  return item.metadata?.origin==='SOURCE_VISUAL'?{sourceMediaAssetId:item.metadata.sourceMediaAssetId,sourceReferenceId:item.metadata.sourceReferenceId,evidenceKind:item.metadata.evidenceKind,originalChecksum:item.metadata.originalChecksum}:{};
}

function formatPostingTimeSlots(rawTime?: string): string {
  if (!rawTime || !rawTime.trim()) return "10:00 AM";
  const slots = rawTime.split(",").map((t) => t.trim()).filter(Boolean);
  const formatted = slots.map((timeStr) => {
    const [hStr, mStr] = timeStr.split(":");
    const h = parseInt(hStr, 10);
    if (isNaN(h)) return timeStr;
    const m = mStr ? mStr.padStart(2, "0") : "00";
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${ampm}`;
  });
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")} & ${formatted[formatted.length - 1]}`;
}


export function getPlatformCopyForConcept(
  concept: any,
  platform: string,
  docName?: string
): { caption: string; hashtags: string[] } {
  if (!concept) return { caption: "", hashtags: [] };
  const title = concept.conceptTitle || concept.title || "Business Strategy & Execution";
  const rawExcerpt = concept.sourceExcerpt || concept.prompt || "";
  const excerpt = rawExcerpt.replace(/\s+/g, " ").trim();
  const cleanDoc = (docName || "Business Document").replace(/\.pdf$/i, "").replace(/[-_]/g, " ");

  // Extract clean keywords for hashtags
  const topicWords = title
    .split(/\s+/)
    .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((w: string) => w.length > 3);
  const baseTags = [
    cleanDoc.split(" ")[0] || "Business",
    ...topicWords.slice(0, 3),
    "DueDiligence",
    "Strategy",
    "Growth",
  ];
  const uniqueTags = Array.from(new Set(baseTags.map((t) => `#${t.charAt(0).toUpperCase() + t.slice(1)}`))).slice(0, 5);
  const tagString = uniqueTags.join(" ");

  if (platform === "LinkedIn") {
    return {
      caption: `Strategic Architecture: ${title}\n\nIn modern enterprise governance, foundational clarity and rigorous verification drive sustainable advantage. Core operational principle from our official strategic roadmap:\n\n"${excerpt || "Rigorous diligence and transparent verification systems establish defensible market leadership."}"\n\nExplore our business frameworks, transparent milestones, and complete operational disclosures at www.redhash.world\n\n${tagString}`,
      hashtags: uniqueTags,
    };
  } else if (platform === "Instagram") {
    return {
      caption: `✨ ${title.toUpperCase()}\n\nExecution begins with uncompromising standards. Key strategic insight from our corporate documentation:\n\n📌 "${excerpt || "Continuous diligence and precision governance empower long-term value creation."}"\n\nDrop a comment with your perspective below or tap the link in bio for the complete disclosure.\n\n.\n.\n${tagString} #ExecutiveFocus #EnterpriseExcellence`,
      hashtags: uniqueTags,
    };
  } else if (platform === "Telegram") {
    return {
      caption: `📊 **${title}**\n\nOfficial Insight Briefing from **${cleanDoc}**:\n\n> "${excerpt || "Comprehensive platform architecture guarantees transparent, verifiable participation."}"\n\n🔗 Official portal & documentation: https://t.me/hindustan_social_network\n\n${tagString}`,
      hashtags: uniqueTags,
    };
  } else if (platform === "Facebook") {
    return {
      caption: `${title}\n\nFoundational diligence and operational transparency remain essential in today's digital economy. Here is a highlighted insight from our verified corporate presentation:\n\n"${excerpt || "Strategic clarity and consistent execution build predictable, high-value outcomes."}"\n\nShare this update with your network and follow our page for daily executive insights!\n\n${tagString}`,
      hashtags: uniqueTags,
    };
  } else {
    // X (Twitter)
    return {
      caption: `${title}: "${excerpt ? (excerpt.length > 130 ? excerpt.slice(0, 127) + "..." : excerpt) : "Foundational diligence drives market resilience."}"\n\n${uniqueTags.slice(0, 3).join(" ")}`,
      hashtags: uniqueTags.slice(0, 3),
    };
  }
}

export default function AIStudio() {
  const s = useOutletContext<Snapshot>();
  const nav = useNavigate();
  const query = useQueryClient();
  const demo = useSession((x) => x.demo);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showClipdropModal, setShowClipdropModal] = useState(false);
  const [activePlanForStudio, setActivePlanForStudio] = useState<string | null>(null);
  const [showAutoPilotGuide, setShowAutoPilotGuide] = useState(false);
  const [attachedVisual, setAttachedVisual] = useState<{ assetId: string; url: string; filename: string } | null>(null);
  const [generatedEvidence, setGeneratedEvidence] = useState<any[]>([]);

  // Studio Mode: 'topic' | 'pdf'
  const [studioParams, setStudioParams] = useSearchParams();
  const activeTab = studioParams.get('tab') === 'automation' ? 'automation' : studioParams.get('tab') === 'pdf' ? 'pdf' : 'topic';
  const storedAutoPosts = useQuery({
    queryKey: ["studio-autopilot-posts", s.workspace.id],
    queryFn: () => request<{ plans: any[]; settings?: any; workspace?: any }>("/knowledge-automation"),
    enabled: !demo && activeTab === "pdf",
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
  });
  const setActiveTab = (tab: 'topic' | 'pdf' | 'automation') => setStudioParams({tab});

  const isAutoPilotActive = Boolean(storedAutoPosts.data?.settings?.enabled);
  const dynamicPostingSlot = formatPostingTimeSlots(
    storedAutoPosts.data?.settings?.posting_time || (s.workspace as any)?.festival_post_time || "10:00"
  );

  const nextScheduledPlan = storedAutoPosts.data?.plans?.find(
    (p: any) => p.publish_state === "ENQUEUED" || p.content_status === "SCHEDULED"
  );
  const nextScheduledTimeStr = nextScheduledPlan?.execute_at || nextScheduledPlan?.proposed_at
    ? new Date(nextScheduledPlan.execute_at || nextScheduledPlan.proposed_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  // Topic Mode state
  const [topic, setTopic] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(()=>{
    const connected = s.accounts.filter(a=>a.state.toLowerCase()==='connected').map(a=>platforms.find(p=>p.toLowerCase()===a.platform.toLowerCase())).filter((p):p is Platform=>!!p && p!=='YouTube');
    return connected.length ? [...new Set(connected)].slice(0,5) : ['LinkedIn','Instagram'];
  });
  const [tone, setTone] = useState(s?.brand?.tone || "Professional");
  const [goal, setGoal] = useState("Engagement");
  const [audience, setAudience] = useState("General Professional");

  // PDF Mode state
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const selectedDocRef=useRef(selectedDocId);selectedDocRef.current=selectedDocId;
  const [activeDoc, setActiveDoc] = useState<DocItem | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<string[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [extractingKnowledge, setExtractingKnowledge] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    currentName: string;
  } | null>(null);
  const [autopilotRunning, setAutopilotRunning] = useState(false);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [activeBrandIdentity, setActiveBrandIdentity] = useState<DocumentBrandIdentity | null>(null);

  useEffect(() => {
    if (selectedDocId) {
      documentsApi
        .getBrandIdentity(selectedDocId)
        .then((b) => setActiveBrandIdentity(b))
        .catch(() => setActiveBrandIdentity(null));
    } else {
      setActiveBrandIdentity(null);
    }
  }, [selectedDocId]);

  const [activeDispatchConcept, setActiveDispatchConcept] = useState<any | null>(null);
  const [activeDispatchSlot, setActiveDispatchSlot] = useState<{ slotNumber: number; slotLabel: string; timeStr: string } | null>(null);
  const [isPostingLiveNow, setIsPostingLiveNow] = useState(false);
  const [editedDispatchCaptions, setEditedDispatchCaptions] = useState<Record<string, string>>({});
  const [isEditingDispatchCopy, setIsEditingDispatchCopy] = useState(false);
  const [dynamicScheduleInfo, setDynamicScheduleInfo] = useState<{
    slotsText: string;
    nextPostText: string;
    activeSlotsCount: number;
  }>(() => {
    try {
      const saved = localStorage.getItem("contentos_dispatch_slots");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sorted = [...parsed].sort((a: any, b: any) => (a.time || "").localeCompare(b.time || ""));
          const fmt = (t: string) => {
            const [hStr, mStr] = (t || "10:00").split(":");
            let h = parseInt(hStr, 10) || 0;
            const m = parseInt(mStr, 10) || 0;
            const period = h >= 12 ? "PM" : "AM";
            if (h === 0) h = 12;
            else if (h > 12) h -= 12;
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
          };
          return {
            slotsText: sorted.map((s: any) => fmt(s.time)).join(", "),
            nextPostText: `Today at ${fmt(sorted[0].time)}`,
            activeSlotsCount: sorted.length,
          };
        }
      }
    } catch {}
    return {
      slotsText: "10:00 AM, 02:00 PM, 06:00 PM",
      nextPostText: "Today at 10:00 AM",
      activeSlotsCount: 3,
    };
  });

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [savedContentId, setSavedContentId] = useState<string | undefined>();
  const [generatedVariants, setGeneratedVariants] = useState<Partial<Record<Platform, string>>>({});
  const [activePreviewPlatform, setActivePreviewPlatform] = useState<Platform>("LinkedIn");
  const [posterScript, setPosterScript] = useState<{ prompt: string; headline: string } | null>(null);
  const [isGeneratingPosterScript, setIsGeneratingPosterScript] = useState(false);
  const [posterScripts, setPosterScripts] = useState<Array<{
    id: string;
    page: number;
    concept: string;
    excerpt: string;
    knowledgeType: string;
    sourceImageUrl: string | null;
    mediaAssetId: string | null;
    posterPrompt: string;
    headline: string;
    caption: string;
    hashtags: string[];
  }>>([]);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [copiedScriptId, setCopiedScriptId] = useState<string | null>(null);
  const [refreshingScriptId, setRefreshingScriptId] = useState<string | number | null>(null);
  const [isRegeneratingSinglePrompt, setIsRegeneratingSinglePrompt] = useState(false);
  const [isGeneratingVisual, setIsGeneratingVisual] = useState(false);
  const currentVisualJobIdRef = useRef<string | null>(null);

  // Platform limits mapping
  const platformLimits: Record<Platform, number> = {
    LinkedIn: 3000,
    Instagram: 2200,
    Facebook: 63206,
    X: 280,
    Telegram: 4096,
    YouTube: 5000,
  };

  function loadPlanIntoStudio(plan: any) {
    if (!plan) return;
    const targets = ((plan.platforms as string[]) || ["LinkedIn", "Instagram", "Facebook", "Telegram"]).filter((platform: string) =>
      ["LinkedIn", "Instagram", "Facebook", "Telegram", "X", "YouTube"].includes(platform)
    ) as Platform[];
    setGeneratedTitle(plan.title || plan.source_snapshot?.headline || "AI Post");
    setSelectedPlatforms(targets);
    setActivePreviewPlatform(targets[0] || "LinkedIn");

    const variants = (plan.variants || {}) as Record<string, any>;
    const newVars: Partial<Record<Platform, string>> = {};
    for (const t of targets) {
      const v = variants[t];
      newVars[t] = typeof v === "string" ? v : v?.caption || plan.body || "";
    }
    setGeneratedVariants(newVars);

    const visual =
      targets.map((platform) => variants[platform]).find((variant) => variant?.mediaAssetId && variant?.mediaUrl) ||
      (plan.source_snapshot?.mediaUrl
        ? { mediaAssetId: plan.media_asset_id, url: plan.source_snapshot.mediaUrl, filename: "AutoPilot Visual" }
        : null);
    setAttachedVisual(
      visual
        ? { assetId: visual.mediaAssetId || (visual as any).assetId, url: visual.url || visual.mediaUrl, filename: "AutoPilot Visual" }
        : null
    );

    if (plan.source_snapshot?.posterPrompt) {
      setPosterScript({
        prompt: plan.source_snapshot.posterPrompt,
        headline: plan.source_snapshot.headline || plan.title,
      });
    }
  }

  // Auto-sync initial active plan into the right-hand preview panel so user sees real AI output
  const initialPlanSyncedRef = useRef(false);
  useEffect(() => {
    if (activeTab === "pdf" && !initialPlanSyncedRef.current && storedAutoPosts.data?.plans?.length) {
      const firstWithContent = storedAutoPosts.data.plans.find((p: any) => p.content_id) || storedAutoPosts.data.plans[0];
      if (firstWithContent) {
        initialPlanSyncedRef.current = true;
        loadPlanIntoStudio(firstWithContent);
      }
    }
  }, [activeTab, storedAutoPosts.data?.plans]);

  // Load existing documents when PDF tab is active
  useEffect(() => {
    if (activeTab === "pdf") {
      fetchDocuments();
    }
  }, [activeTab]);

  // Clear concept preview when document is deselected or removed
  useEffect(() => {
    if (!selectedDocId || !activeDoc) {
      setActiveDispatchConcept(null);
      setActiveDispatchSlot(null);
      setAttachedVisual(null);
    }
  }, [selectedDocId, activeDoc]);

  // Poll active document status if QUEUED, PROCESSING, EXTRACTING, CHUNKING
  useEffect(() => {
    if (!selectedDocId || activeTab !== "pdf") return;

    let timer: NodeJS.Timeout;
    let isCancelled = false;

    const checkDoc = async () => {
      try {
        const doc = await documentsApi.get(selectedDocId);
        if (isCancelled) return;

        setActiveDoc(doc);
        setDocuments((prev) =>
          prev.map((d) => (d.id === doc.id ? { ...d, ...doc } : d))
        );

        if (doc.status === "READY") {
          // Load knowledge automatically when document is ready
          fetchKnowledge(selectedDocId);
        } else if (doc.status !== "FAILED") {
          // Stream knowledge items in real time as they arrive
          fetchKnowledge(selectedDocId, 0, true);
          // Keep polling while QUEUED, PROCESSING, EXTRACTING, CHUNKING
          timer = setTimeout(checkDoc, 1500);
        }
      } catch (err: any) {
        if (err?.message?.includes("404") || err?.status === 404) {
          setSelectedDocId(null);
          setActiveDoc(null);
          return;
        }
        console.error("Doc status check error:", err);
      }
    };

    checkDoc();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [selectedDocId, activeTab]);

  async function fetchDocuments() {
    try {
      setLoadingDocs(true);
      const docs = await documentsApi.list();
      setDocuments(docs);
      if (docs.length > 0 && !selectedDocId) {
        setSelectedDocId(docs[0].id);
        setActiveDoc(docs[0]);
        if (docs[0].status === "READY") {
          fetchKnowledge(docs[0].id);
        }
      }
    } catch (err) {
      console.error("Error fetching documents:", err);
    } finally {
      setLoadingDocs(false);
    }
  }

  async function fetchKnowledge(docId: string, retryCount = 0, silent = false) {
    try {
      if (!silent && retryCount === 0 && knowledgeItems.length === 0) setLoadingKnowledge(true);
      const items = await documentsApi.listKnowledge(docId);
      if (items.length > 0) {
        setKnowledgeItems(items);
        setSelectedKnowledgeIds((prev) => {
          const newIds = items.map((k) => k.id);
          return Array.from(new Set([...prev, ...newIds]));
        });
        setLoadingKnowledge(false);
        setExtractingKnowledge(false);
        void triggerFastPosterScript(items, activeDoc?.original_filename);
        void fetchPosterScripts(docId);
        return;
      }

      // If document is READY but worker auto-extraction is still finishing in the background
      if (items.length === 0 && !silent && retryCount < 12) {
        setTimeout(() => {
          fetchKnowledge(docId, retryCount + 1, false);
        }, 1500);
      } else if (!silent) {
        setKnowledgeItems([]);
        setLoadingKnowledge(false);
        setExtractingKnowledge(false);
      }
    } catch (err) {
      console.error("Error fetching knowledge:", err);
      if (!silent) {
        setLoadingKnowledge(false);
        setExtractingKnowledge(false);
      }
    }
  }

  async function triggerFastPosterScript(items: Array<{ id: string; knowledge_key?: string; value: any; source_excerpt?: string }>, docName?: string) {
    if (!items || !items.length) return;
    try {
      setIsGeneratingPosterScript(true);
      const topItem = items[0];
      const concept = typeof topItem.value === "string" ? topItem.value : JSON.stringify(topItem.value);
      const excerpt = topItem.source_excerpt || "";
      const title = topItem.knowledge_key || docName || "SaaS Insights";

      const res = await request<{ prompt: string; headline: string }>("/clipdrop/suggest-poster-prompt", "POST", {
        knowledgeConcept: concept,
        excerpt,
        sourceVisualContext: `Extracted from PDF ${docName || "document"}`,
        title,
        platform: activePreviewPlatform || "Instagram",
      });

      if (res?.prompt) {
        setPosterScript(res);
        setGeneratedTitle(res.headline || title);

        // If plans are already generated, keep the real high quality LLM variants
        if (storedAutoPosts.data?.plans?.length) {
          return;
        }

        const defaultPlatforms: Platform[] = ["LinkedIn", "Instagram", "Facebook", "Telegram"];
        const newVariants: Partial<Record<Platform, string>> = {};
        const safeWords = (title || docName || "Strategy")
          .split(/[\s-_]+/)
          .filter(w => w.length > 2 && /^[a-zA-Z0-9]+$/.test(w))
          .map(w => `#${w[0].toUpperCase()}${w.slice(1)}`);
        const hashtags = safeWords.length ? safeWords.slice(0, 4) : ["#Business", "#Insights", "#Strategy", "#Growth"];
        for (const p of defaultPlatforms) {
          if (p === "LinkedIn") {
            newVariants[p] = `🚀 ${res.headline || title}\n\n${concept}\n\nKey takeaways from our latest technical breakdown.\n\n${hashtags.join(" ")}`;
          } else if (p === "Instagram") {
            newVariants[p] = `✨ ${res.headline || title}\n\n${concept}\n\n${hashtags.join(" ")}`;
          } else if (p === "Telegram") {
            newVariants[p] = `⚡️ *${res.headline || title}*\n\n${concept}\n\n${hashtags.join(" ")}`;
          } else {
            newVariants[p] = `${res.headline || title}: ${concept}\n\n${hashtags.join(" ")}`;
          }
        }
        setGeneratedVariants((prev) => ({ ...newVariants, ...prev }));
        toast.success("⚡ AI Poster Script & Multi-Platform Copy generated instantly!");
      }
    } catch (err) {
      console.warn("Fast poster script generation notice:", err);
    } finally {
      setIsGeneratingPosterScript(false);
    }
  }

  async function fetchPosterScripts(docId: string) {
    if (!docId) return;
    try {
      setLoadingScripts(true);
      const scripts = await documentsApi.listPosterScripts(docId);
      setPosterScripts(scripts);
      if (scripts.length > 0 && !posterScript) {
        setGeneratedTitle(scripts[0].headline);
        setPosterScript({ prompt: scripts[0].posterPrompt, headline: scripts[0].headline });
      }
    } catch (err) {
      console.warn("Could not load poster scripts:", err);
    } finally {
      setLoadingScripts(false);
    }
  }

  const handleRefreshActivePrompt = async () => {
    if (!posterScript?.headline && !generatedTitle) return;
    const jobId = Math.random().toString(36).substring(2, 9);
    currentVisualJobIdRef.current = jobId;

    try {
      setIsRegeneratingSinglePrompt(true);
      const res = await request<{ prompt: string; headline: string }>(
        "/clipdrop/suggest-poster-prompt",
        "POST",
        {
          knowledgeConcept: generatedTitle || posterScript?.headline || "Executive Summary",
          excerpt: knowledgeItems[0]?.source_excerpt || "",
          title: generatedTitle || posterScript?.headline,
          sourceVisualContext: `Extracted from PDF ${activeDoc?.original_filename || "document"}`,
          platform: activePreviewPlatform,
          documentId: selectedDocId || undefined,
          documentName: activeDoc?.original_filename || undefined,
        }
      );
      if (res?.prompt) {
        setPosterScript({ prompt: res.prompt, headline: res.headline || generatedTitle });
        // Immediately clear previous visual so stale/mismatched image (e.g. Diwali diyas) does NOT display!
        setAttachedVisual(null);
        setIsGeneratingVisual(true);

        try {
          const imgRes = await clipdropApi.generateImage({
            prompt: res.prompt,
            headline: res.headline || generatedTitle,
            platform: activePreviewPlatform,
            aspectRatio: "1:1",
            engine: "flux",
            enableOverlay: false,
          });
          // Ensure this job is still the active one (prevent race conditions)
          if (currentVisualJobIdRef.current === jobId && imgRes?.url) {
            setAttachedVisual({
              assetId: imgRes.assetId,
              url: imgRes.url,
              filename: `${res.headline || generatedTitle}.png`,
            });
            toast.success("✨ Dynamic prompt & fresh visual image generated!");
            return;
          }
        } catch (imgErr) {
          console.warn("Could not auto-generate visual in studio preview:", imgErr);
          toast.error("Visual generation failed. You can retry with Generate Visual.");
        } finally {
          if (currentVisualJobIdRef.current === jobId) {
            setIsGeneratingVisual(false);
          }
        }
        toast.success("✨ Dynamic visual prompt regenerated!");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate prompt");
    } finally {
      setIsRegeneratingSinglePrompt(false);
    }
  };


  async function handleDeleteDocument(docId: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    try {
      await documentsApi.delete(docId);
      setDocuments((prev) => {
        const remaining = prev.filter((d) => d.id !== docId);
        if (selectedDocId === docId) {
          if (remaining.length > 0) {
            setSelectedDocId(remaining[0].id);
            setActiveDoc(remaining[0]);
            if (remaining[0].status === "READY") {
              fetchKnowledge(remaining[0].id);
            }
          } else {
            setSelectedDocId(null);
            setActiveDoc(null);
            setKnowledgeItems([]);
            setSelectedKnowledgeIds([]);
            setActiveDispatchConcept(null);
            setActiveDispatchSlot(null);
            setAttachedVisual(null);
            setEditedDispatchCaptions({});
          }
        }
        return remaining;
      });
      toast.success("PDF document deleted / canceled");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete PDF document");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFiles = Array.from(e.target.files || []);
    if (!rawFiles.length) return;
    const files = rawFiles.filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!files.length) {
      toast.error("Please select valid PDF files.");
      return;
    }

    try {
      setUploadingPdf(true);
      setError(null);

      if (files.length === 1) {
        const file = files[0];
        const res = await documentsApi.uploadPdf(file);
        toast.success(`PDF uploaded: ${file.name}`);
        setSelectedDocId(res.documentId);
        await fetchDocuments();
        if (res.status === "READY") {
          await fetchKnowledge(res.documentId);
        }
      } else {
        // High-speed parallel batch upload
        setBatchProgress({
          total: files.length,
          completed: 0,
          currentName: files[0].name,
        });
        const uploaded = await documentsApi.uploadBatchPdfs(
          files,
          (completed, total, currentName) => {
            setBatchProgress({ total, completed, currentName });
          },
        );
        toast.success(
          `Batch upload completed: ${uploaded.length} of ${files.length} PDFs uploaded successfully!`,
        );
        if (uploaded.length > 0) {
          setSelectedDocId(uploaded[0].documentId);
        }
        await fetchDocuments();
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploadingPdf(false);
      setBatchProgress(null);
      e.target.value = "";
    }
  }

  async function handleFastTrack(docId: string) {
    try {
      toast.info("Fast-tracking extraction & knowledge analysis...");
      const res = await documentsApi.fastTrack(docId);
      setActiveDoc((prev) =>
        prev
          ? {
              ...prev,
              status: "READY",
              page_count: res.pageCount ?? prev.page_count,
            }
          : null,
      );
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, status: "READY", page_count: res.pageCount ?? d.page_count }
            : d,
        ),
      );
      await fetchKnowledge(docId);
      toast.success("PDF processing & knowledge extraction complete!");
    } catch (err: any) {
      toast.error(err.message || "Failed to fast-track PDF");
    }
  }

  async function handleTriggerKnowledgeExtract() {
    if (!selectedDocId) return;
    try {
      setExtractingKnowledge(true);
      setLoadingKnowledge(true);
      setError(null);
      const res = await documentsApi.extractKnowledge(selectedDocId);
      if (res.status === "PROCESSING" || res.status === "EXTRACTING" || res.status === "CHUNKING") {
        toast.info("Document is currently extracting text. Knowledge will be extracted as soon as it's ready.");
      } else {
        toast.success("Extracting key insights & claims from document...");
      }
      // Poll knowledge items
      setTimeout(() => {
        fetchKnowledge(selectedDocId, 0);
      }, 1500);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
      setExtractingKnowledge(false);
      setLoadingKnowledge(false);
    }
  }

  function togglePlatform(p: Platform) {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
    if (!selectedPlatforms.includes(p) && selectedPlatforms.length === 0) {
      setActivePreviewPlatform(p);
    }
  }

  function toggleKnowledgeSelect(id: string) {
    setSelectedKnowledgeIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  
  async function handleDispatchActiveConceptNow() {
    if (!selectedDocId || !activeDispatchConcept) {
      toast.error("No active scheduled concept selected to dispatch.");
      return;
    }
    setIsPostingLiveNow(true);
    try {
      await request(
        `/documents/${selectedDocId}/visual-concepts/${activeDispatchConcept.id}/dispatch`,
        "POST",
        { channels: selectedPlatforms.length ? selectedPlatforms : ["LinkedIn", "Instagram", "Facebook", "Telegram"] }
      );
      toast.success("🚀 Post published successfully to live social channels!");
      await Promise.all([
        query.invalidateQueries({ queryKey: ["dispatch-history"] }),
        query.invalidateQueries({ queryKey: ["knowledge-automation"] }),
        query.invalidateQueries({ queryKey: ["posts"] }),
        query.invalidateQueries({ queryKey: ["calendar"] }),
        query.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    } catch (err: any) {
      toast.error(err.message || "Failed to dispatch post live.");
    } finally {
      setIsPostingLiveNow(false);
    }
  }

  async function handleToggleAutoPilot() {
    if (!selectedDocId) {
      toast.error("Please select a PDF document first.");
      return;
    }
    const currentlyActive = Boolean(storedAutoPosts.data?.settings?.enabled);
    setAutopilotRunning(true);
    try {
      if (currentlyActive) {
        // STOP AUTOPILOT
        const currentSettings = storedAutoPosts.data?.settings || {};
        await request("/knowledge-automation/settings", "PATCH", {
          enabled: false,
          horizonDays: currentSettings.horizon_days || 14,
          cooldownDays: currentSettings.cooldown_days || 90,
          platforms: currentSettings.platforms || ["LinkedIn"],
          postingTime: currentSettings.posting_time || "10:00",
          posterStyle: currentSettings.poster_style || "AI_POSTER",
        });
        toast.success("⏸️ Auto-Pilot stopped! Automatic publishing is now paused.");
      } else {
        // START AUTOPILOT
        const currentSettings = storedAutoPosts.data?.settings || {};
        await request("/knowledge-automation/settings", "PATCH", {
          enabled: true,
          horizonDays: currentSettings.horizon_days || 14,
          cooldownDays: currentSettings.cooldown_days || 90,
          platforms: currentSettings.platforms || ["LinkedIn"],
          postingTime: currentSettings.posting_time || "10:00",
          posterStyle: currentSettings.poster_style || "AI_POSTER",
        });
        const res = await request<{ success: boolean; generated: number; message: string }>(
          "/knowledge-automation/auto-pilot",
          "POST",
          { documentId: selectedDocId }
        );
        toast.success(res.message || "⚡ 100% Zero-Touch Auto-Pilot activated!");

        const startTime = Date.now();
        const pollTimer = setInterval(async () => {
          const updated = await storedAutoPosts.refetch();
          if ((updated.data?.plans && updated.data.plans.length > 0) || Date.now() - startTime > 45000) {
            clearInterval(pollTimer);
          }
        }, 3000);
      }

      await Promise.all([
        query.invalidateQueries({ queryKey: ["documents"] }),
        query.invalidateQueries({ queryKey: ["posts"] }),
        query.invalidateQueries({ queryKey: ["calendar"] }),
        query.invalidateQueries({ queryKey: ["knowledge-automation"] }),
        query.invalidateQueries({ queryKey: ["studio-autopilot-posts"] }),
        query.invalidateQueries({ queryKey: ["workspace"] }),
      ]);
      await storedAutoPosts.refetch();
    } catch (err: any) {
      toast.error(err.message || "Auto-Pilot action failed.");
    } finally {
      setAutopilotRunning(false);
    }
  }

  // Backward compatibility alias
  const handleTriggerAutoPilot = handleToggleAutoPilot;

  async function handleGeneratePosts() {
    try {
      setError(null);
      if (!selectedPlatforms.length) {
        throw new Error("Please select at least one social platform.");
      }

      let promptTopic = topic.trim();
      if (activeTab === "pdf") {
        const selectedItems = knowledgeItems.filter((k) =>
          selectedKnowledgeIds.includes(k.id)
        );
        if (!selectedItems.length) {
          throw new Error(
            "Please select at least one extracted knowledge item or claim from the PDF."
          );
        }
        const knowledgeSummary = selectedItems
          .map(
            (k, idx) =>
              `Point ${idx + 1} (${k.knowledge_type}): ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)}\nSource page: ${k.page_start || 'unavailable'}${k.page_end && k.page_end!==k.page_start ? `–${k.page_end}` : ''}\nSource excerpt: ${k.source_excerpt || 'unavailable'}`
          )
          .join("\n\n");
        promptTopic = `Generate social media posts based on the following verified PDF knowledge:\n\nDocument: ${
          activeDoc?.original_filename || "Attached PDF"
        }\nTarget Audience: ${audience}\n\nKey Knowledge & Insights:\n${knowledgeSummary}`;
        if (promptTopic.length > 4000) {
          promptTopic = promptTopic.slice(0, 4000);
        }
      } else {
        if (promptTopic.length < 5) {
          throw new Error("Please provide a topic or prompt of at least 5 characters.");
        }
      }
      promptTopic = `${promptTopic}\nTarget audience: ${audience}`;

      setIsGenerating(true);
      setSavedContentId(undefined);
      let result: { title: string; variants: Partial<Record<Platform, string>> } = {
        title: "AI Studio Post",
        variants: {},
      };

      if (demo) {
        const mockVariants: Partial<Record<Platform, string>> = {};
        for (const p of selectedPlatforms) {
          if (p === "X") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `📊 New insights from ${activeDoc?.original_filename || "PDF"}:\n• 74% reduction in content adaptation overhead\n• 3.5x publication velocity boost\n\nWhat's your team's biggest publishing bottleneck?`
                : `${promptTopic.slice(0, 140)}\n\nOne actionable takeaway for your team today.`;
          } else if (p === "LinkedIn") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `Company knowledge deserves a life beyond static PDF documents.\n\nKey takeaways from "${activeDoc?.original_filename || "Product Strategy"}":\n\n1. Content Velocity: Structured platform scheduling increases workflow speed by 3.5x.\n2. Adaptation Savings: Benchmarks across 120 marketing teams showed 74% reduction in manual copy adaptation time.\n3. Brand Compliance: Real-time AI guardrails prevent unapproved phrasing before submission.\n\n${s.brand.cta}`
                : `Let's talk about ${promptTopic}.\n\nMeaningful progress starts with clear structure and deliberate execution. Share what you learn, empower your team, and build on ideas that deliver impact.\n\n${s.brand.cta}`;
          } else if (p === "Instagram") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `Turn your team's whitepapers into bite-sized social insights. ✨\n\nKey facts extracted from our latest document:\n- 3.5x publication throughput\n- 74% time saved on adaptation\n- 100% brand voice alignment\n\nSave this for your next team sprint! 🚀\n\n${s.brand.hashtags}`
                : `${promptTopic}\n\nA fresh perspective for your next creative session. Save this post for reference.\n\n${s.brand.hashtags}`;
          } else if (p === "Telegram") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `📢 **Document Highlight**: ${activeDoc?.original_filename || "PDF Overview"}\n\nWe extracted key evidence from our whitepaper:\n• 74% lower copy adaptation time\n• Real-time brand safety guardrails\n• Verified page citations\n\nWhat topics should we cover next?`
                : `Hello community! Here is a breakdown of ${promptTopic.toLowerCase()}.\n\nWhat has worked best for your team? Share your thoughts below.`;
          } else {
            mockVariants[p] = `Deep Dive: ${promptTopic}\n\nIn this video description, we break down actionable steps and key performance metrics to help your team succeed.`;
          }
        }

        result = {
          title:
            activeTab === "pdf"
              ? `PDF Insights: ${activeDoc?.original_filename.replace(/\.pdf$/i, "") || "Knowledge"}`
              : topic.slice(0, 60),
          variants: mockVariants,
        };
        toast.info("Generated captions loaded for preview.");
      } else {
        result = await request("/ai/captions", "POST", {
          topic: promptTopic,
          tone,
          goal,
          platforms: selectedPlatforms,
        });
      }

      setGeneratedTitle(result.title || "AI Studio Post");
      setGeneratedVariants(result.variants || {});
      setActivePreviewPlatform(selectedPlatforms[0] || "LinkedIn");
      if (!(await handleSaveToLibrary(result, false))) throw new Error('Content was generated but could not be saved for review. Retry saving below.');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  }

  // Batch Generation State
  const [batchGenerationId, setBatchGenerationId] = useState<string | null>(null);

  async function handleBatchGenerateFromKnowledge() {
    try {
      setError(null);
      const selectedItems = knowledgeItems.filter((k) =>
        selectedKnowledgeIds.includes(k.id)
      );

      if (!selectedItems.length) {
        throw new Error("Select at least one knowledge item for batch generation.");
      }

      setIsGenerating(true);
      const itemsPayload = selectedItems.map((k, idx) => ({
        topic: `Knowledge Item ${idx + 1} (${k.knowledge_type}): ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)}\nSource page: ${k.page_start || 'unavailable'}\nExcerpt: ${k.source_excerpt || 'unavailable'}\nAudience: ${audience}`.slice(0, 2000),
        tone,
        goal,
        platforms: selectedPlatforms,
        sourceEvidence:[{documentId:selectedDocId,documentName:activeDoc?.original_filename,knowledgeId:k.id,pageStart:k.page_start,pageEnd:k.page_end,excerpt:k.source_excerpt,...visualEvidence(k)}],
      }));

      const res = (await request("/batch/ai-generation", "POST", {
        items: itemsPayload,
      })) as { batchId: string };

      setBatchGenerationId(res.batchId);
      toast.success(`Started batch AI generation for ${selectedItems.length} knowledge items!`);
    } catch (err: any) {
      setError(err.message || "Batch generation failed.");
      toast.error(err.message || "Batch generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveToLibrary(generation?: {title:string;variants:Partial<Record<Platform,string>>}, navigate = true, visual = attachedVisual) {
    try {
      setError(null);
      let visualToUse = visual;
      if (!visualToUse && activeTab === 'pdf' && selectedDocId) {
        try {
          const media = await request<any>(`/documents/${selectedDocId}/source-media`);
          if (media.assets && media.assets.length > 0) {
            const selectedItems = knowledgeItems.filter(k => selectedKnowledgeIds.includes(k.id));
            const targetPage = selectedItems.find(k => k.page_start)?.page_start;
            const matchedAsset = (targetPage ? media.assets.find((a: any) => a.pageNumber === targetPage) : null) || media.assets[0];
            if (matchedAsset) {
              visualToUse = {
                assetId: matchedAsset.assetId,
                url: matchedAsset.url,
                filename: `PDF page ${matchedAsset.pageNumber} visual`,
              };
              setAttachedVisual(visualToUse);
            }
          }
        } catch (e) {
          console.warn("Could not auto-pair PDF visual:", e);
        }
      }
      const titleToSave = generation?.title || generatedTitle;
      const variantsToSave = generation?.variants || generatedVariants;
      if (!titleToSave.trim() || !Object.keys(variantsToSave).length) {
        throw new Error("No generated content available to save.");
      }

      setIsSaving(true);
      const firstPlatform = selectedPlatforms[0] || "LinkedIn";
      const baseBody = variantsToSave[firstPlatform] || Object.values(variantsToSave)[0] || "";

      // Attach visual media asset to variants if generated
      const finalVariants: Record<string, any> = {};
      const sourceEvidence = generation ? (activeTab === 'pdf' ? knowledgeItems.filter(k=>selectedKnowledgeIds.includes(k.id)).map(k=>({documentId:selectedDocId,documentName:activeDoc?.original_filename,knowledgeId:k.id,pageStart:k.page_start,pageEnd:k.page_end,excerpt:k.source_excerpt,...visualEvidence(k)})) : []) : generatedEvidence;
      if (generation) setGeneratedEvidence(sourceEvidence);
      for (const [p, val] of Object.entries(variantsToSave)) {
        if (visualToUse) {
          finalVariants[p] = {
            caption: typeof val === "string" ? val : (val as any)?.caption || "",
            mediaAssetId: visualToUse.assetId,
            mediaUrl: visualToUse.url,
            mediaType: "image",
            metadata: {sourceEvidence},
          };
        } else {
          finalVariants[p] = {caption:val,metadata:{sourceEvidence}};
        }
      }

      const saved = await data.save({
        id: generation ? undefined : savedContentId,
        title: titleToSave,
        body: baseBody,
        platforms: selectedPlatforms,
        variants: finalVariants,
      });
      setSavedContentId(saved.id);
      await data.transition(saved.id,'review');

      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Platform-specific posts saved to Content Library · Needs Review");
      if (navigate) nav("/app/library");
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="ai-studio-container" style={{ paddingBottom: "40px" }}>
      {/* Active Batch Progress Indicator */}
      {batchGenerationId && (
        <BatchProgressIndicator
          batchId={batchGenerationId}
          onComplete={() => {
            query.invalidateQueries({ queryKey: ["workspace"] });
            toast.success("Batch generation finished. Check Content Library → Needs Review.");
          }}
        />
      )}

      <div className="page-heading" style={{ marginBottom: "16px" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          AI Studio
        </h1>
      </div>

      {/* Premium Segmented Navigation Tabs */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px",
          borderRadius: "10px",
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "14px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("topic")}
          className={activeTab === 'topic' ? 'active' : ''}
          aria-pressed={activeTab === 'topic'}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            padding: "7px 15px",
            borderRadius: "7px",
            border: activeTab === "topic" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid transparent",
            background: activeTab === "topic" ? "rgba(255, 255, 255, 0.08)" : "transparent",
            color: activeTab === "topic" ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: activeTab === "topic" ? 600 : 500,
            fontSize: "0.82rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 0.15s ease",
            boxShadow: activeTab === "topic" ? "0 1px 3px rgba(0, 0, 0, 0.3)" : "none",
          }}
        >
          <FileText size={14} style={{ opacity: activeTab === "topic" ? 1 : 0.7 }} />
          Create content
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("pdf")}
          className={activeTab === 'pdf' ? 'active' : ''}
          aria-pressed={activeTab === 'pdf'}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            padding: "7px 15px",
            borderRadius: "7px",
            border: activeTab === "pdf" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid transparent",
            background: activeTab === "pdf" ? "rgba(255, 255, 255, 0.08)" : "transparent",
            color: activeTab === "pdf" ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: activeTab === "pdf" ? 600 : 500,
            fontSize: "0.82rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 0.15s ease",
            boxShadow: activeTab === "pdf" ? "0 1px 3px rgba(0, 0, 0, 0.3)" : "none",
          }}
        >
          <BookOpen size={14} style={{ opacity: activeTab === "pdf" ? 1 : 0.7 }} />
          Business knowledge
          <span
            style={{
              background: activeTab === "pdf" ? "rgba(99, 102, 241, 0.25)" : "rgba(255, 255, 255, 0.06)",
              color: activeTab === "pdf" ? "#c7d2fe" : "var(--color-text-muted, #94a3b8)",
              border: activeTab === "pdf" ? "1px solid rgba(129, 140, 248, 0.35)" : "1px solid rgba(255, 255, 255, 0.08)",
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "4px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.4px",
            }}
          >
            PDF
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("automation")}
          className={activeTab === 'automation' ? 'active' : ''}
          aria-pressed={activeTab === 'automation'}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            padding: "7px 15px",
            borderRadius: "7px",
            border: activeTab === "automation" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid transparent",
            background: activeTab === "automation" ? "rgba(255, 255, 255, 0.08)" : "transparent",
            color: activeTab === "automation" ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: activeTab === "automation" ? 600 : 500,
            fontSize: "0.82rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 0.15s ease",
            boxShadow: activeTab === "automation" ? "0 1px 3px rgba(0, 0, 0, 0.3)" : "none",
          }}
        >
          <History size={14} style={{ opacity: activeTab === "automation" ? 1 : 0.7 }} />
          Autopilot History
          <span
            style={{
              background: activeTab === "automation" ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.06)",
              color: activeTab === "automation" ? "#34d399" : "var(--color-text-muted, #94a3b8)",
              border: activeTab === "automation" ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "4px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.4px",
            }}
          >
            10 Days
          </span>
        </button>
      </div>

      {activeTab === 'automation' && <KnowledgeAutomation embedded />}
      <div className="composer-grid studio-creation-grid" style={{ display: activeTab === 'automation' ? 'none' : "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 420px)", gap: "24px" }}>
        {/* Main Creation Column */}
        <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {activeTab === "topic" ? (
            /* TOPIC MODE PANEL */
            <div className="panel" style={{ padding: "24px" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Sparkles size={18} style={{ color: "#6366f1" }} />
                Describe Your Content Idea
              </h2>
              <div className="composer-fields" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <label>
                  Topic or Key Idea
                  <textarea
                    rows={4}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Launched our new real-time AI publishing workflow. Reduced content distribution overhead by 70% for marketing teams."
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </label>

                <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
                  <label>
                    Brand Tone
                    <select value={tone} onChange={(e) => setTone(e.target.value)}>
                      {["Professional", "Bold", "Educational", "Conversational", "Technical", "Promotional"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Strategic Goal
                    <select value={goal} onChange={(e) => setGoal(e.target.value)}>
                      {["Awareness", "Engagement", "Leads", "Website Traffic", "Product Launch"].map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target Audience
                    <input
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="e.g. Product Managers"
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            /* REAL-WORLD MINIMAL SAAS PDF WORKSPACE */
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* 1. Sleek Document Toolbar Header (shown when active document exists) */}
              {activeDoc && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.025)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    <div style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "6px",
                      background: "rgba(99, 102, 241, 0.12)",
                      border: "1px solid rgba(99, 102, 241, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <FileText size={15} color="#818cf8" />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "0.88rem", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {activeDoc.original_filename}
                      </strong>
                      <span style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        padding: "1px 7px",
                        borderRadius: "4px",
                        background: activeDoc.status === "READY" ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)",
                        color: activeDoc.status === "READY" ? "#34d399" : "#fbbf24",
                        border: `1px solid ${activeDoc.status === "READY" ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.25)"}`,
                      }}>
                        {activeDoc.status}
                      </span>
                      {Boolean(activeDoc.page_count && activeDoc.page_count > 0) && (
                        <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                          {activeDoc.page_count} pages
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    {documents.length > 1 && (
                      <select
                        value={selectedDocId || ""}
                        onChange={(e) => {
                          const doc = documents.find((d) => d.id === e.target.value);
                          if (doc) {
                            setSelectedDocId(doc.id);
                            setActiveDoc(doc);
                            if (doc.status === "READY") {
                              fetchKnowledge(doc.id);
                              fetchPosterScripts(doc.id);
                            }
                          }
                        }}
                        style={{
                          height: "30px",
                          boxSizing: "border-box",
                          background: "rgba(255, 255, 255, 0.04)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          color: "#f8fafc",
                          borderRadius: "6px",
                          padding: "0 8px",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                        }}
                      >
                        {documents.map((d) => (
                          <option key={d.id} value={d.id} style={{ background: "#0f172a" }}>
                            {d.original_filename} ({d.status})
                          </option>
                        ))}
                      </select>
                    )}

                    {(activeDoc.status === "READY" || activeDoc.status === "FAILED") && (
                      <button
                        type="button"
                        onClick={handleTriggerKnowledgeExtract}
                        disabled={extractingKnowledge || loadingKnowledge}
                        title="Re-extract knowledge claims"
                        style={{
                          height: "30px",
                          boxSizing: "border-box",
                          background: "rgba(255, 255, 255, 0.04)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          color: "var(--color-text-muted)",
                          borderRadius: "6px",
                          padding: "0 10px",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          lineHeight: 1,
                          margin: 0,
                        }}
                      >
                        <RotateCw size={12} className={extractingKnowledge ? "animate-spin" : ""} />
                        {extractingKnowledge ? "Extracting..." : "Re-extract"}
                      </button>
                    )}

                    

                    {activeDoc && (
                      <button
                        type="button"
                        onClick={() => setShowBrandModal(true)}
                        title="Configure Per-PDF Brand Identity (Logo, Domain, Colors)"
                        style={{
                          height: "30px",
                          boxSizing: "border-box",
                          background: activeBrandIdentity?.status === "CONFIRMED"
                            ? "rgba(16, 185, 129, 0.12)"
                            : "rgba(99, 102, 241, 0.15)",
                          border: activeBrandIdentity?.status === "CONFIRMED"
                            ? "1px solid rgba(16, 185, 129, 0.35)"
                            : "1px solid rgba(99, 102, 241, 0.35)",
                          color: activeBrandIdentity?.status === "CONFIRMED" ? "#34d399" : "#c7d2fe",
                          borderRadius: "6px",
                          padding: "0 10px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          lineHeight: 1,
                          margin: 0,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Palette size={12} />
                        Brand Identity
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: activeBrandIdentity?.status === "CONFIRMED" ? "#10b981" : "#f59e0b",
                            display: "inline-block",
                          }}
                        />
                      </button>
                    )}

                    <label style={{
                      height: "30px",
                      boxSizing: "border-box",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "0 12px",
                      borderRadius: "6px",
                      background: "rgba(99, 102, 241, 0.15)",
                      border: "1px solid rgba(99, 102, 241, 0.3)",
                      color: "#c7d2fe",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: uploadingPdf ? "wait" : "pointer",
                      transition: "all 0.15s ease",
                      lineHeight: 1,
                      margin: 0,
                      userSelect: "none",
                    }}>
                      <Upload size={12} />
                      {uploadingPdf ? "Uploading..." : "Add / Replace PDF"}
                      <input
                        type="file"
                        multiple
                        accept=".pdf,application/pdf"
                        style={{ display: "none" }}
                        disabled={uploadingPdf}
                        onChange={handleFileUpload}
                      />
                    </label>

                    <button
                      type="button"
                      title="Delete document"
                      onClick={(e) => handleDeleteDocument(activeDoc.id, e)}
                      style={{
                        height: "30px",
                        width: "30px",
                        boxSizing: "border-box",
                        background: "rgba(239, 68, 68, 0.08)",
                        border: "1px solid rgba(239, 68, 68, 0.2)",
                        color: "#f87171",
                        borderRadius: "6px",
                        padding: 0,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                        margin: 0,
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* Batch upload progress indicator if active */}
              {batchProgress && (
                <div style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: "6px", padding: "8px 12px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: "4px" }}>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>Processing: {batchProgress.completed}/{batchProgress.total}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>{batchProgress.currentName}</span>
                  </div>
                  <div style={{ height: "3px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "2px", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(batchProgress.completed / batchProgress.total) * 100}%`,
                        background: "#6366f1",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Fallback clean dropzone only when no document uploaded */}
              {!activeDoc && (
                <div
                  style={{
                    border: "1px dashed rgba(255, 255, 255, 0.15)",
                    borderRadius: "10px",
                    padding: "24px 16px",
                    textAlign: "center",
                    background: "rgba(255, 255, 255, 0.015)",
                  }}
                >
                  <Upload size={24} style={{ color: "#818cf8", marginBottom: "8px" }} />
                  <h4 style={{ margin: "0 0 4px", fontSize: "0.9rem", color: "#f8fafc" }}>Upload PDF Document(s)</h4>
                  <p style={{ margin: "0 0 12px", fontSize: "0.76rem", color: "var(--color-text-muted)" }}>
                    Supports batch PDF upload up to 50MB. AI extracts verifiable concepts & generates daily visual schedule.
                  </p>
                  <label className="button primary" style={{ cursor: uploadingPdf ? "wait" : "pointer", display: "inline-flex", gap: "6px", padding: "6px 14px", fontSize: "0.8rem" }}>
                    <Upload size={13} />
                    {uploadingPdf ? "Uploading..." : "Select PDF File"}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,application/pdf"
                      style={{ display: "none" }}
                      disabled={uploadingPdf}
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
              )}

              {/* 2. Sleek Minimal Auto-Pilot Status Toolbar */}
              {selectedDocId && (
                <div
                  style={{
                    padding: "8px 14px",
                    borderRadius: "10px",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "0.72rem",
                        padding: "2px 8px",
                        borderRadius: "100px",
                        background: isAutoPilotActive ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.05)",
                        color: isAutoPilotActive ? "#34d399" : "var(--color-text-muted)",
                        border: `1px solid ${isAutoPilotActive ? "rgba(16, 185, 129, 0.25)" : "rgba(255, 255, 255, 0.1)"}`,
                        fontWeight: 600,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isAutoPilotActive ? "#10b981" : "#64748b", display: "inline-block" }} />
                      {isAutoPilotActive ? "Auto-Pilot Active" : "Auto-Pilot Paused"}
                    </span>

                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Slots ({dynamicScheduleInfo.activeSlotsCount}/day): <strong style={{ color: "#38bdf8" }}>{dynamicScheduleInfo.slotsText}</strong>
                      {isAutoPilotActive ? ` • Next: ${dynamicScheduleInfo.nextPostText}` : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => setActiveTab("automation")}
                      title="View 10-day autopilot history"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        color: "var(--color-text-muted)",
                        padding: "5px 10px",
                        borderRadius: "6px",
                        fontSize: "0.74rem",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      <History size={12} /> History
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAutoPilotGuide(true)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        color: "var(--color-text-muted)",
                        padding: "5px 10px",
                        borderRadius: "6px",
                        fontSize: "0.74rem",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      <BookOpen size={12} /> Guide
                    </button>
                    <button
                      type="button"
                      disabled={autopilotRunning}
                      onClick={handleToggleAutoPilot}
                      style={{
                        background: isAutoPilotActive ? "rgba(239, 68, 68, 0.12)" : "#4f46e5",
                        color: isAutoPilotActive ? "#f87171" : "#ffffff",
                        border: isAutoPilotActive ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid #6366f1",
                        fontWeight: 600,
                        padding: "5px 12px",
                        borderRadius: "6px",
                        fontSize: "0.76rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        cursor: "pointer",
                      }}
                    >
                      {autopilotRunning ? "Processing..." : isAutoPilotActive ? "⏸ Pause Auto-Pilot" : "⚡ Start Auto-Pilot"}
                    </button>
                  </div>
                </div>
              )}

              {/* Guide Modal */}
              {showAutoPilotGuide && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(0, 0, 0, 0.75)",
                    backdropFilter: "blur(6px)",
                    zIndex: 9999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "20px",
                  }}
                  onClick={() => setShowAutoPilotGuide(false)}
                >
                  <div
                    style={{
                      background: "#0f172a",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "14px",
                      maxWidth: "560px",
                      width: "100%",
                      padding: "22px",
                      color: "#f8fafc",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Sparkles size={18} color="#818cf8" />
                        <h2 style={{ fontSize: "1.05rem", margin: 0, fontWeight: 700 }}>How PDF Auto-Pilot Works</h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAutoPilotGuide(false)}
                        style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#4f46e5", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.75rem", flexShrink: 0 }}>1</div>
                        <div>
                          <strong style={{ display: "block", fontSize: "0.85rem", color: "#fff" }}>Upload Your Business Document</strong>
                          <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "#94a3b8", lineHeight: 1.4 }}>
                            Upload PDF reports or decks. Core storytelling concepts and images are extracted automatically.
                          </p>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.75rem", flexShrink: 0 }}>2</div>
                        <div>
                          <strong style={{ display: "block", fontSize: "0.85rem", color: "#fff" }}>Set Daily Dispatch Schedule</strong>
                          <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "#94a3b8", lineHeight: 1.4 }}>
                            Choose 1, 2, or 3 slots/day. Posts are assigned sequentially and dynamically scheduled.
                          </p>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.75rem", flexShrink: 0 }}>3</div>
                        <div>
                          <strong style={{ display: "block", fontSize: "0.85rem", color: "#fff" }}>Autonomous Publishing & Updates</strong>
                          <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "#94a3b8", lineHeight: 1.4 }}>
                            At designated slot times, posts are dispatched to selected channels and archived in History.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                      <Button variant="primary" onClick={() => setShowAutoPilotGuide(false)} style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
                        Got it!
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Primary Workspace: Document Visual Storytelling Hub */}
              {selectedDocId && activeDoc && (
                <DocumentVisualConceptsHub
                  key={selectedDocId}
                  documentId={selectedDocId}
                  documentName={activeDoc.original_filename}
                  selectedAssetId={attachedVisual?.assetId}
                  activeConceptId={activeDispatchConcept?.id}
                  onActiveConceptSelect={(concept, slotInfo) => {
                    setActiveDispatchConcept(concept);
                    if (slotInfo) setActiveDispatchSlot(slotInfo);
                    if (concept.imageUrl) {
                      setAttachedVisual({
                        assetId: concept.assetId || `concept-${concept.id}`,
                        url: concept.imageUrl,
                        headline: concept.conceptTitle,
                        prompt: concept.prompt,
                        engine: "flux",
                      });
                    }
                  }}
                  onSelectVisual={(visual) => {
                    setAttachedVisual({
                      assetId: visual.assetId,
                      url: visual.url,
                      headline: visual.headline,
                      prompt: visual.prompt,
                      engine: "flux",
                    });
                  }}
                  onScheduleUpdate={(info) => {
                    setDynamicScheduleInfo({
                      slotsText: info.slotsText,
                      nextPostText: info.nextPostText,
                      activeSlotsCount: info.activeSlotsCount,
                    });
                  }}
                />
              )}

              {/* 4. Collapsible Document Citations & Claims */}
              {knowledgeItems.length > 0 && (
                <details style={{
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  padding: "10px 14px",
                }}>
                  <summary style={{
                    cursor: "pointer",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    color: "var(--color-text-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    userSelect: "none",
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Quote size={14} style={{ color: "var(--success)" }} />
                      Extracted Document Citations & Claims ({knowledgeItems.length})
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "#818cf8" }}>View Citations ▾</span>
                  </summary>

                  <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "280px", overflowY: "auto" }}>
                    {knowledgeItems.map((item) => {
                      const isSelected = selectedKnowledgeIds.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleKnowledgeSelect(item.id)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            background: isSelected ? "rgba(99, 102, 241, 0.08)" : "rgba(255, 255, 255, 0.02)",
                            border: isSelected ? "1px solid rgba(99, 102, 241, 0.3)" : "1px solid rgba(255, 255, 255, 0.05)",
                            cursor: "pointer",
                            fontSize: "0.78rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                            <div style={{ paddingTop: "1px", color: isSelected ? "#818cf8" : "var(--color-text-muted)" }}>
                              {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <strong style={{ color: "#f8fafc", display: "block" }}>{item.knowledge_key}</strong>
                              <p style={{ margin: "2px 0 0", color: "#cbd5e1", fontSize: "0.76rem", lineHeight: 1.35 }}>
                                {typeof item.value === "string" ? item.value : JSON.stringify(item.value)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              {/* 5. Collapsible Manual Generation Tool (Flat & Non-glowing) */}
              <details style={{
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                padding: "10px 14px",
              }}>
                <summary style={{
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  userSelect: "none",
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Sliders size={14} />
                    Manual Post Generation & Overrides (Optional)
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "#818cf8" }}>Show Controls ▾</span>
                </summary>

                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {platforms.map((p) => {
                      const isSel = selectedPlatforms.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePlatform(p)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "5px 10px",
                            borderRadius: "6px",
                            border: isSel ? "1px solid #6366f1" : "1px solid rgba(255, 255, 255, 0.08)",
                            background: isSel ? "rgba(99, 102, 241, 0.2)" : "rgba(255, 255, 255, 0.03)",
                            color: isSel ? "#fff" : "var(--color-text-muted)",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                          }}
                        >
                          <PlatformIcon platform={p} />
                          {p}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <Button
                      variant="primary"
                      onClick={handleGeneratePosts}
                      disabled={isGenerating || (activeTab === "pdf" && !selectedKnowledgeIds.length)}
                      style={{
                        padding: "8px 12px",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        background: "#4f46e5",
                        border: "1px solid #6366f1",
                        boxShadow: "none",
                      }}
                    >
                      <Sparkles size={14} />
                      {isGenerating ? "Generating..." : `Generate Post (${selectedKnowledgeIds.length} items)`}
                    </Button>

                    <Button
                      type="button"
                      onClick={() => setShowClipdropModal(true)}
                      style={{
                        padding: "8px 12px",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        color: "#f8fafc",
                        boxShadow: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <Wand2 size={14} />
                      Custom Visual Generator
                    </Button>
                  </div>
                </div>
              </details>
            </div>
          )}
        </section>

        {/* Preview & Variant Editing Column */}
        <aside className="preview-column" style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
          <div className="panel" style={{ padding: "14px", display: "flex", flexDirection: "column" }}>
            {activeTab === "pdf" && activeDoc && activeDispatchConcept ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                {/* Compact Header */}
                <div style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.08) 100%)",
                  border: "1px solid rgba(129, 140, 248, 0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "3px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      ⚡ NEXT UPCOMING POST
                    </span>
                    <span style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#38bdf8",
                      background: "rgba(56, 189, 248, 0.12)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      padding: "1px 7px",
                      borderRadius: "5px",
                    }}>
                      Slot #{activeDispatchSlot?.slotNumber || 1} • {activeDispatchSlot?.timeStr || "10:30 AM"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                    <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {activeDispatchConcept.conceptTitle}
                    </h4>
                    <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
                      Pg {activeDispatchConcept.sourcePage || 1}
                    </span>
                  </div>
                </div>

                {/* Compact Platform Variant Chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {["LinkedIn", "Instagram", "Facebook", "Telegram", "X"].map((p) => {
                    const isActive = activePreviewPlatform === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setActivePreviewPlatform(p as Platform)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "4px 9px",
                          borderRadius: "6px",
                          border: isActive ? "1px solid #6366f1" : "1px solid rgba(255, 255, 255, 0.08)",
                          background: isActive ? "rgba(99, 102, 241, 0.25)" : "rgba(255, 255, 255, 0.03)",
                          color: isActive ? "#ffffff" : "var(--color-text-muted)",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                          fontWeight: isActive ? 700 : 500,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <PlatformIcon platform={p} />
                        {p}
                      </button>
                    );
                  })}
                </div>

                {/* Interactive Social Feed Card (Unified Preview + Edit) */}
                <div style={{
                  background: "rgba(15, 23, 42, 0.65)",
                  border: "1px solid rgba(255, 255, 255, 0.09)",
                  borderRadius: "10px",
                  padding: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}>
                  {/* Channel Header + Controls */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <div style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: "0.78rem",
                        flexShrink: 0,
                      }}>
                        {s?.brand?.name?.[0] || s?.workspace?.name?.[0] || "C"}
                      </div>
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <strong style={{ fontSize: "0.8rem", color: "#f8fafc", display: "block", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {s?.brand?.name || s?.workspace?.name || "ContentOS"}
                        </strong>
                        <span style={{ fontSize: "0.68rem", color: "var(--color-text-muted)" }}>
                          {activePreviewPlatform} • {activeDispatchSlot?.timeStr || "10:30 AM"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => setIsEditingDispatchCopy(!isEditingDispatchCopy)}
                        style={{
                          background: isEditingDispatchCopy ? "rgba(99, 102, 241, 0.2)" : "rgba(255, 255, 255, 0.05)",
                          border: isEditingDispatchCopy ? "1px solid #818cf8" : "1px solid rgba(255, 255, 255, 0.1)",
                          color: isEditingDispatchCopy ? "#818cf8" : "var(--color-text-muted)",
                          borderRadius: "5px",
                          padding: "3px 8px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {isEditingDispatchCopy ? (
                          <>
                            <Check size={11} /> Done
                          </>
                        ) : (
                          <>
                            <Pencil size={11} /> Edit Copy
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const copyData = getPlatformCopyForConcept(activeDispatchConcept, activePreviewPlatform, activeDoc?.original_filename);
                          const textToCopy = editedDispatchCaptions[activeDispatchConcept.id + '_' + activePreviewPlatform] ?? copyData.caption;
                          navigator.clipboard?.writeText(textToCopy);
                          toast.success('Copied ' + activePreviewPlatform + ' caption!');
                        }}
                        style={{
                          background: "rgba(255, 255, 255, 0.05)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          color: "var(--color-text-muted)",
                          borderRadius: "5px",
                          padding: "3px 8px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <Copy size={11} /> Copy
                      </button>
                    </div>
                  </div>

                  {/* Caption Content (Inline Edit or Preview) */}
                  {isEditingDispatchCopy ? (
                    <div>
                      <textarea
                        rows={4}
                        value={
                          editedDispatchCaptions[activeDispatchConcept.id + '_' + activePreviewPlatform] ??
                          getPlatformCopyForConcept(activeDispatchConcept, activePreviewPlatform, activeDoc?.original_filename).caption
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditedDispatchCaptions((prev) => ({
                            ...prev,
                            [activeDispatchConcept.id + '_' + activePreviewPlatform]: val,
                          }));
                        }}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          fontSize: "0.8rem",
                          lineHeight: 1.4,
                          borderRadius: "6px",
                          background: "rgba(2, 6, 23, 0.7)",
                          border: "1px solid rgba(99, 102, 241, 0.35)",
                          color: "#f8fafc",
                          resize: "vertical",
                        }}
                        autoFocus
                      />
                      <div style={{ textAlign: "right", fontSize: "0.68rem", color: "var(--color-text-muted)", marginTop: "2px" }}>
                        {(editedDispatchCaptions[activeDispatchConcept.id + '_' + activePreviewPlatform] ??
                          getPlatformCopyForConcept(activeDispatchConcept, activePreviewPlatform, activeDoc?.original_filename).caption).length} chars
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      maxHeight: "110px",
                      overflowY: "auto",
                      paddingRight: "4px",
                    }}>
                      <p style={{
                        margin: 0,
                        fontSize: "0.8rem",
                        color: "#e2e8f0",
                        lineHeight: 1.45,
                        whiteSpace: "pre-line",
                      }}>
                        {editedDispatchCaptions[activeDispatchConcept.id + '_' + activePreviewPlatform] ??
                          getPlatformCopyForConcept(activeDispatchConcept, activePreviewPlatform, activeDoc?.original_filename).caption}
                      </p>
                    </div>
                  )}

                  {/* Compact Attached Image */}
                  {activeDispatchConcept.imageUrl ? (
                    <div
                      style={{
                        position: "relative",
                        borderRadius: "8px",
                        overflow: "hidden",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        background: "#090d16",
                        cursor: "pointer",
                        height: "135px",
                      }}
                      onClick={() =>
                        setAttachedVisual({
                          assetId: activeDispatchConcept.assetId || ('concept-' + activeDispatchConcept.id),
                          url: activeDispatchConcept.imageUrl,
                          headline: activeDispatchConcept.conceptTitle,
                          prompt: activeDispatchConcept.prompt,
                          engine: "flux",
                        })
                      }
                    >
                      <img
                        src={resolveMediaUrl(activeDispatchConcept.imageUrl)}
                        alt={activeDispatchConcept.conceptTitle}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          bottom: "6px",
                          right: "6px",
                          background: "rgba(0, 0, 0, 0.75)",
                          color: "#fff",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          fontSize: "9px",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <Eye size={10} /> Expand
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          top: "6px",
                          left: "6px",
                          background: "rgba(15, 23, 42, 0.8)",
                          color: "#38bdf8",
                          border: "1px solid rgba(56, 189, 248, 0.3)",
                          padding: "2px 6px",
                          borderRadius: "5px",
                          fontSize: "9px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <Sparkles size={10} /> AI Concept Visual
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: "16px",
                      textAlign: "center",
                      borderRadius: "6px",
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px dashed rgba(255, 255, 255, 0.08)",
                      color: "var(--color-text-muted)",
                      fontSize: "0.75rem",
                    }}>
                      Visual generation completed. Image will attach upon dispatch.
                    </div>
                  )}

                  {/* Social Action Footer Bar */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: "6px",
                    borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                    fontSize: "0.72rem",
                    color: "var(--color-text-muted)",
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <ThumbsUp size={12} /> Like
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <MessageSquare size={12} /> Comment
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Share2 size={12} /> Share
                    </span>
                  </div>
                </div>

                {/* Collapsible Prompt Accordion */}
                {activeDispatchConcept.prompt && (
                  <details style={{
                    background: "rgba(0, 0, 0, 0.25)",
                    border: "1px solid rgba(168, 85, 247, 0.2)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    fontSize: "0.72rem",
                  }}>
                    <summary style={{
                      cursor: "pointer",
                      color: "#c084fc",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      userSelect: "none",
                    }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <Sparkles size={11} /> FLUX.1 Visual Prompt
                      </span>
                      <span style={{ fontSize: "0.68rem", color: "var(--color-text-muted)" }}>View / Copy Prompt ▾</span>
                    </summary>
                    <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px dashed rgba(168, 85, 247, 0.2)" }}>
                      <p style={{ margin: "0 0 6px", color: "#cbd5e1", fontStyle: "italic", lineHeight: 1.4 }}>
                        &ldquo;{activeDispatchConcept.prompt}&rdquo;
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard?.writeText(activeDispatchConcept.prompt);
                          toast.success("Prompt copied to clipboard!");
                        }}
                        style={{
                          background: "rgba(168, 85, 247, 0.15)",
                          border: "1px solid rgba(168, 85, 247, 0.3)",
                          color: "#d8b4fe",
                          fontSize: "0.68rem",
                          borderRadius: "4px",
                          padding: "3px 8px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <Copy size={10} /> Copy Prompt Text
                      </button>
                    </div>
                  </details>
                )}

                {/* Post Now Action Button */}
                <Button
                  variant="primary"
                  disabled={isPostingLiveNow}
                  onClick={handleDispatchActiveConceptNow}
                  style={{
                    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                    fontWeight: 700,
                    padding: "9px 16px",
                    fontSize: "0.85rem",
                    border: "none",
                    boxShadow: "0 4px 14px rgba(16, 185, 129, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    cursor: "pointer",
                  }}
                >
                  <Send size={14} />
                  {isPostingLiveNow ? "Dispatching Live..." : "🚀 Post This Concept Now"}
                </Button>
              </div>
            ) : activeTab === "pdf" ? (
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "360px",
                textAlign: "center",
                padding: "36px 20px",
                borderRadius: "12px",
                background: "rgba(15, 23, 42, 0.4)",
                border: "1px dashed rgba(255, 255, 255, 0.08)",
                gap: "12px",
              }}>
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: "rgba(99, 102, 241, 0.1)",
                  border: "1px solid rgba(99, 102, 241, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#818cf8",
                }}>
                  <FileText size={22} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "#f8fafc" }}>
                    No Upcoming Post Scheduled
                  </h4>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-text-muted)", maxWidth: "260px", lineHeight: 1.5 }}>
                    {documents.length === 0
                      ? "Upload a PDF document to automatically generate visual concepts and schedule upcoming posts."
                      : "Select a concept from your document to preview social copy and scheduled time slots."}
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", flex: 1 }}>
                <div className="preview-heading" style={{ marginBottom: "14px" }}>
                  <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Generated Post Variants</h2>
                  <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Preview &amp; refine copy for each platform</span>
                </div>

                {/* Platform Variant Tabs */}
                <div className="preview-tabs" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px", paddingBottom: "4px" }}>
                  {selectedPlatforms.map((p) => {
                    const isActive = activePreviewPlatform === p;
                    const hasVariant = !!generatedVariants[p];
                    return (
                      <button
                        key={p}
                        type="button"
                        className={isActive ? "active" : ""}
                        onClick={() => setActivePreviewPlatform(p)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          border: "none",
                          background: isActive ? "#6366f1" : "var(--surface2)",
                          color: isActive ? "#fff" : "var(--color-text-muted)",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        <PlatformIcon platform={p} />
                        {p}
                        {hasVariant && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />}
                      </button>
                    );
                  })}
                </div>

                {Object.keys(generatedVariants).length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center", color: "var(--color-text-muted)", border: "1px dashed var(--border)", borderRadius: "10px", gap: "14px" }}>
                    <Sparkles size={38} style={{ color: "var(--accent)", opacity: 0.8 }} />
                    <div>
                      <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem", color: "var(--ink)", fontWeight: 700 }}>Ready for Generation</h3>
                      <p style={{ margin: 0, fontSize: "0.85rem", maxWidth: "290px", lineHeight: 1.5 }}>
                        Select extracted claims from your PDF or enter topics to produce channel-specific copy.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
                    <textarea
                      rows={8}
                      value={generatedVariants[activePreviewPlatform] || ""}
                      onChange={(e) =>
                        setGeneratedVariants((prev) => ({
                          ...prev,
                          [activePreviewPlatform]: e.target.value,
                        }))
                      }
                      style={{ width: "100%", padding: "10px", fontSize: "0.85rem", lineHeight: 1.5 }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <PublishPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title={generatedTitle}
        body={Object.values(generatedVariants)[0] || ""}
        platforms={selectedPlatforms}
        variants={generatedVariants}
      />

      <ClipdropImageModal
        composerMode
        attachmentLabel="Image for generated posts · saved for review"
        isOpen={showClipdropModal}
        onClose={() => {
          setShowClipdropModal(false);
          setActivePlanForStudio(null);
        }}
        onAttach={async (result) => {
          setAttachedVisual(result);
          if (activeScriptIndex !== null) {
            setPosterScripts((prev) =>
              prev.map((s, i) =>
                i === activeScriptIndex
                  ? { ...s, sourceImageUrl: result.url, mediaAssetId: result.assetId }
                  : s
              )
            );
          }
          if (activePlanForStudio) {
            try {
              await request(`/knowledge-automation/plans/${activePlanForStudio}/update-visual`, "POST", {
                mediaUrl: result.url,
                mediaAssetId: result.assetId,
              });
              await storedAutoPosts.refetch();
            } catch (e) {
              console.warn("Could not update plan visual:", e);
            }
          }
          if (savedContentId) void handleSaveToLibrary(undefined,false,result);
          toast.success("Attached visual to this draft post!");
        }}
        initialContentText={[
          generatedVariants[activePreviewPlatform] || topic,
          knowledgeItems
            .filter((k) => selectedKnowledgeIds.includes(k.id))
            .map((k) => `${k.knowledge_key}: ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)}`)
            .join("\n"),
        ]
          .filter(Boolean)
          .join("\n\nExtracted Knowledge:\n")}
        initialTitle={generatedTitle}
        initialPrompt={posterScript?.prompt}
        targetPlatform={activePreviewPlatform}
        accounts={s?.accounts || []}
        brandName={s?.brand?.name}
        brandWebsite={s?.brand?.website}
        brandCta={s?.brand?.cta}
      />
      {selectedDocId && (
        <BrandIdentityModal
          isOpen={showBrandModal}
          onClose={() => setShowBrandModal(false)}
          documentId={selectedDocId}
          documentName={activeDoc?.original_filename || "Document"}
          sampleImageUrl={activeDispatchConcept?.imageUrl || null}
          onBrandUpdated={(brand) => {
            setActiveBrandIdentity(brand);
            void query.invalidateQueries({ queryKey: ["document-concepts", selectedDocId] });
          }}
        />
      )}
    </div>
  );
}
