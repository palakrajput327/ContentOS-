export function normalizeText(rawText: string): string {
  if (!rawText) return "";

  return rawText
    // Remove null / non-printable control characters (except newline, tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Normalize Windows/Mac line endings to \n
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Replace 3 or more consecutive newlines with double newline (paragraph boundary)
    .replace(/\n{3,}/g, "\n\n")
    // Normalize multiple inline spaces or tabs to a single space
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
