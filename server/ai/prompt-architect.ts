import { getLLMProvider } from "./llm.service.js";
import { z } from "zod";
import type { BusinessKnowledgeProfile } from "../knowledge/business-profile.service.js";

export interface StructuredVisualSpecification {
  objective: string;
  visualConcept: string;
  mainSubject: string;
  composition: string;
  brandIdentity: string;
  artDirection: string;
  factualDetails: string;
  constraints: string;
  outputSpecs: string;
  generationPrompt: string;
  headline: string;
}

const promptArchitectOutputSchema = z.object({
  objective: z.string().optional().default("Communicate core business principle with authority and clarity."),
  visualConcept: z.string().optional().default("Architectural tiered hierarchy with clean physical layers."),
  mainSubject: z.string().optional().default("Precision physical subject with tangible matte and metallic materials."),
  composition: z.string().optional().default("Balanced three-quarter isometric perspective with clean negative space."),
  brandIdentity: z.string().optional().default("Refined navy blue, platinum silver, controlled soft directional lighting."),
  artDirection: z.string().optional().default("High-end corporate editorial 3D architectural visualization."),
  factualDetails: z.string().optional().default("Grounded structural arrangement reflecting verified document tiers."),
  constraints: z.string().optional().default("No floating coins, random holograms, unverified numbers, or festive diyas."),
  outputSpecs: z.string().optional().default("Social-media ready composition, 1:1 or 4:5 aspect ratio."),
  generationPrompt: z.string().describe("The final synthesized, single-paragraph text-to-image prompt (55-110 words) for the image generator."),
  headline: z.string().optional().default("Key Insight"),
}).passthrough();

export const IMAGE_PROMPT_ARCHITECT_SYSTEM_PROMPT = `You are the Lead 3D Commercial Advertising Creative Director and Image Prompt Architect for ContentOS.
Your purpose is to translate real business knowledge and document facts into ultra-luxury, high-converting 3D Commercial Advertising Posters for modern AI image generators (FLUX.1, Midjourney).

CORE PHILOSOPHY:
Every visual must be an eye-catching, high-converting commercial advertising poster with bold 3D typography in quotes, heroic metallic centerpieces, and luxury cinematic aesthetics.

PROVEN 3D COMMERCIAL POSTER ARCHETYPES:
1. Power Metaphor Posters (Strength, Vision, Market Growth): Sculpted solid 24k polished gold charging bull, fierce chrome lion, or golden robotic eagle on black obsidian volcanic rock with floating gold ember sparks, engraved golden world map on dark matte carbon background, bold 3D embossed metallic gold typography in quotes, 3D golden brand coin medallion, Octane Render, 8k raytracing.
2. Executive Penthouse Posters (Daily ROI, Earnings, Freedom): Financial executive seated in luxury armchair looking out panoramic floor-to-ceiling glass window of high-rise penthouse at sunset overlooking illuminated Dubai Burj Khalifa skyline, obsidian marble desk with trading laptop showing glowing candlestick charts, 3D red growth arrow surging upward, giant bold 3D embossed metallic gold typography in quotes (e.g. "EARN 1% - 3% DAILY RETURN").
3. 3D High-Tech Brand Emblem Posters (Ecosystem, Tech, Global Reach): Circular 3D luxury glass & gold emblem badge, holographic glowing earth sphere with orbital neon data rings, neural AI circuit tracks, floating crypto tokens (BTC, ETH, USDT), ascending golden zigzag breakout arrow, glowing emerald candlestick pillars, 3D chrome typography.
4. Multi-Tier Reward Bonanza Posters (Tiers, Referral, Multiplier): Ascending 3D golden tiered platforms with floating metallic black & gold VIP membership cards, 3D golden treasure chest emitting volumetric light beams, floating golden percentage multiplier badges (e.g. "5X ACCELERATOR", "EXECUTIVE ROYALTY 5% POOL").
4. CONSISTENT 9-POINT SPECIFICATION:
   Follow the structured 9-point thinking process:
   01 Objective
   02 Visual concept
   03 Main subject
   04 Composition
   05 Brand identity
   06 Art direction
   07 Factual details
   08 Constraints
   09 Output specifications
5. THE FINAL GENERATION PROMPT:
   In "generationPrompt", synthesize the above into an evocative, high-fidelity paragraph of 55 to 110 words.
   Describe what the viewer actually sees: subject, materials, camera perspective, lighting, color grading, clean composition, and negative constraints.`;

export class ImagePromptArchitect {
  async generateSpecification(input: {
    knowledgeConcept: string;
    excerpt?: string;
    title?: string;
    documentName?: string;
    platform?: string;
    aspectRatio?: string;
    brandProfile?: Partial<BusinessKnowledgeProfile>;
  }): Promise<StructuredVisualSpecification> {
    const provider = getLLMProvider();

    const concept = input.knowledgeConcept || input.title || "Business Architecture";
    const excerpt = input.excerpt || "";
    const brand = input.brandProfile;
    const platform = input.platform || "LinkedIn";
    const aspectRatio = input.aspectRatio || (platform === "Instagram" ? "4:5 portrait" : "1:1 square");

    const userMessage = `DOCUMENT CONTEXT:
Document Name: "${input.documentName || "Corporate Profile"}"
Company Name: "${brand?.companyName || "ContentOS Partner"}"
Industry: "${brand?.industry || "Commercial & Professional"}"
Brand Palette: ${brand?.brandColors?.length ? brand.brandColors.join(", ") : "Refined navy blue, platinum silver, and neutral architectural gray"}
Visual Personality: "${brand?.visualPersonality || "High-end corporate editorial, structured 3D product visualization"}"

RELEVANT DOCUMENT TIERS & DATA:
${brand?.numericDataAndTiers?.length ? brand.numericDataAndTiers.map(t => `- ${t.metric}: ${t.value} (${t.rulesOrQualifications})`).join("\n") : "Standard commercial tiers."}

KNOWN CONSTRAINTS / RESTRICTIONS:
${brand?.restrictions?.length ? brand.restrictions.map(r => `- ${r}`).join("\n") : "- Do not invent unverified earnings or coins. Do not include unrelated festive decorations."}

TARGET POST & TOPIC TO VISUALIZE:
Working Title: "${input.title || concept}"
Concept / Core Idea: "${concept.slice(0, 1000)}"
${excerpt ? `Source Document Excerpt: "${excerpt.slice(0, 800)}"` : ""}
Platform: ${platform}
Target Aspect Ratio: ${aspectRatio}`;

    try {
      if (await provider.validateConfiguration()) {
        const res = await provider.generateStructured({
          messages: [
            { role: "system", content: IMAGE_PROMPT_ARCHITECT_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          schema: promptArchitectOutputSchema,
          schemaName: "StructuredImagePromptSpecification",
        });

        const data = res.data as StructuredVisualSpecification;
        if (data?.generationPrompt && data.generationPrompt.trim().length > 20) {
          // Rule-based quality check on generation prompt
          let cleanPrompt = data.generationPrompt.trim();
          // Filter out accidental festive or glowing clutter if present
          if (!/diwali|deepavali|festival/i.test(concept)) {
            cleanPrompt = cleanPrompt.replace(/\b(diya|diyas|oil\s*lamps?|firecrackers?|rangoli)\b/gi, "").trim();
          }
          return {
            ...data,
            generationPrompt: cleanPrompt,
            headline: (data.headline || input.title || "Key Insight").trim().slice(0, 60),
          };
        }
      }
    } catch (err: any) {
      console.warn("[ImagePromptArchitect] LLM generation warning:", err.message || err);
    }

    // High quality deterministic fallback matching the 9-part architecture
    const cleanConcept = (input.title || concept).replace(/[^a-zA-Z0-9 ]/g, " ").trim().slice(0, 80);
    const fallbackPrompt = `A premium corporate editorial-style visual communicating ${cleanConcept}. The central subject features an architectural ascending tier arrangement rendered with physical precision, smooth matte surfaces, subtle metallic accents, and soft directional studio lighting. Composition: balanced three-quarter isometric perspective with clean negative space and neutral architectural backdrop. Visual style: modern commercial visualization, restrained color grading in navy blue and silver, crisp focal clarity. Free of random glowing clutter, festive decorations, or floating coins. Aspect ratio: ${aspectRatio}.`;

    return {
      objective: `Communicate ${cleanConcept} with authority and professional clarity.`,
      visualConcept: `Architectural tiered hierarchy with clean physical layers.`,
      mainSubject: `Precision physical tiers with subtle brushed metal and slate textures.`,
      composition: `Three-quarter isometric angle with clean negative space for headline text.`,
      brandIdentity: `Navy blue, platinum silver, soft studio rim lighting.`,
      artDirection: `Premium corporate editorial 3D visualization.`,
      factualDetails: `Grounded structural arrangement reflecting verified document tiers.`,
      constraints: `No floating coins, random holograms, unverified numbers, or festive diyas.`,
      outputSpecs: `${aspectRatio}, social-ready resolution.`,
      generationPrompt: fallbackPrompt,
      headline: (input.title || cleanConcept).slice(0, 50),
    };
  }
}
