export function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) {
    return escapeHtml(text);
  }
  return window.DOMPurify.sanitize(
    window.marked.parse(text, { gfm: true, breaks: true })
  );
}
export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
