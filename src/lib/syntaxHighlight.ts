import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";

/** Maps a user-chosen interpreter or file extension to a loaded Prism language key. */
export function getPrismLanguage(interpreter: string): string {
  const clean = (interpreter || "").toLowerCase().trim();
  if (clean.includes("python") || clean.endsWith(".py") || clean === "py") {
    return "python";
  }
  if (
    clean.includes("node") ||
    clean.includes("js") ||
    clean.includes("javascript") ||
    clean.includes("deno") ||
    clean.includes("bun") ||
    clean.endsWith(".js") ||
    clean.endsWith(".ts")
  ) {
    return "javascript";
  }
  if (clean.includes("ruby") || clean.endsWith(".rb") || clean === "rb") {
    return "ruby";
  }
  if (clean.includes("json") || clean.endsWith(".json")) {
    return "json";
  }
  if (clean.includes("yaml") || clean.includes("yml") || clean.endsWith(".yaml") || clean.endsWith(".yml")) {
    return "yaml";
  }
  if (clean.includes("md") || clean.includes("markdown")) {
    return "markdown";
  }
  // Default to bash for shell scripts (bash, zsh, sh, fish, etc.)
  return "bash";
}

/** Highlights code using Prism with fallback to plain escaped text. */
export function highlightCode(code: string, language: string): string {
  if (!code) return "";
  const lang = Prism.languages[language] || Prism.languages.bash || Prism.languages.clike;
  if (!lang) {
    return escapeHtml(code);
  }
  try {
    return Prism.highlight(code, lang, language);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
