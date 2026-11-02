import express from "express";
// A 5MB logo expands to about 6.7MB when encoded as JSON/base64.
// Keep the larger limit scoped to the logo endpoint.
export function jsonBodyParsers() {
    const logo = express.json({ limit: "7mb" });
    const standard = express.json({ limit: "16kb" });
    return (req, res, next) => {
        const isLogoUpload = req.method === "POST" && /^\/api\/v1\/documents\/[^/]+\/brand-identity\/upload-logo\/?$/.test(req.path);
        return (isLogoUpload ? logo : standard)(req, res, next);
    };
}
