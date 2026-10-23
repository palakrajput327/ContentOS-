export function normalizeText(rawText) {
    if (!rawText)
        return "";
    return rawText
        // Remove null / non-printable control characters (except newline, tab)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        // Remove email addresses
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, "")
        // Remove website URLs & domain watermarks
        .replace(/\b(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gi, "")
        .replace(/\b[a-zA-Z0-9-]+\.(?:tk|com|net|org|in|io|co|edu)\b/gi, "")
        // Remove page markers like [Page 3]
        .replace(/\[Page\s*\d+\]/gi, "")
        // Remove repeating separator dashes / bars / scan lines
        .replace(/[-_=|~]{3,}/g, " ")
        // Remove OCR noise sequences of single symbols like "| B |x vs ee"
        .replace(/^[|!/\\°~:;.,'\s-]{1,5}$/gm, "")
        // Normalize Windows/Mac line endings to \n
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Replace 3 or more consecutive newlines with double newline (paragraph boundary)
        .replace(/\n{3,}/g, "\n\n")
        // Normalize multiple inline spaces or tabs to a single space
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}
