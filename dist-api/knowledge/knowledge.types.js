import { z } from "zod";
const VALID_TYPES = [
    "COMPANY_NAME",
    "DESCRIPTION",
    "PRODUCT",
    "SERVICE",
    "INDUSTRY",
    "LOCATION",
    "CUSTOMER",
    "CASE_STUDY",
    "STATISTIC",
    "DIFFERENTIATOR",
    "TECHNOLOGY",
    "FAQ",
    "CTA",
    "WEBSITE",
    "CONTACT",
    "CLAIM",
    "CONTENT_TOPIC",
];
export const knowledgeTypeSchema = z.string().transform((val) => {
    const upper = String(val || "").toUpperCase().trim().replace(/[\s-]/g, "_");
    if (VALID_TYPES.includes(upper))
        return upper;
    if (upper === "METRIC")
        return "STATISTIC";
    if (upper === "SUMMARY" || upper === "TOPIC" || upper === "CONCEPT" || upper === "RULE")
        return "CONTENT_TOPIC";
    if (upper === "TECH" || upper === "FRAMEWORK" || upper === "LANGUAGE")
        return "TECHNOLOGY";
    return "CLAIM";
});
export const extractedFactSchema = z.object({
    type: knowledgeTypeSchema,
    key: z.string().min(1).max(256),
    value: z.union([z.string(), z.record(z.any()), z.array(z.any())]),
    supportingChunkIds: z.array(z.string()).optional().default([]),
    confidence: z.number().min(0).max(1).optional().default(0.9),
});
export const baseKnowledgeExtractionOutputSchema = z.object({
    facts: z.array(extractedFactSchema).default([]),
});
export const knowledgeExtractionOutputSchema = z.preprocess((val) => {
    if (Array.isArray(val))
        return { facts: val };
    if (val && typeof val === "object") {
        if (Array.isArray(val.facts))
            return val;
        if (Array.isArray(val.claims))
            return { ...val, facts: val.claims };
        if (Array.isArray(val.items))
            return { ...val, facts: val.items };
        if (Array.isArray(val.knowledge))
            return { ...val, facts: val.knowledge };
    }
    return val;
}, baseKnowledgeExtractionOutputSchema);
