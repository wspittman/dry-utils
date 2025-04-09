import { decode } from "html-entities";
import sanitizeHtml from "sanitize-html";
import Showdown from "showdown";
import TurndownService from "turndown";

/**
 * Standardizes untrusted HTML content by converting it to Markdown and then back to sanitized HTML.
 * @param html - The untrusted HTML content
 * @returns The standardized HTML content
 */
export function standardizeUntrustedHtml(html: string): string {
  const decoded = decode(html);
  const sanitized = sanitizeHtmlContent(decoded);

  const turndownService = new TurndownService();
  const markdown = turndownService.turndown(sanitized);

  return markdownToHtml(markdown);
}

/**
 * Converts Markdown content to sanitized HTML.
 * @param markdown - The Markdown content
 * @returns The sanitized HTML content
 */
export function markdownToHtml(markdown: string): string {
  const converter = new Showdown.Converter();
  const newHtml = converter.makeHtml(markdown);

  return sanitizeHtmlContent(newHtml);
}

/**
 * Sanitizes HTML content to allow safe rendering.
 * @param html - The HTML content to sanitize
 * @returns The sanitized HTML content
 */
export function sanitizeHtmlContent(html: string): string {
  return sanitizeHtml(html, {
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs:
          attribs["href"] && attribs["href"].startsWith("http")
            ? {
                ...attribs,
                target: "_blank",
                rel: "noopener noreferrer",
              }
            : attribs,
      }),
    },
  });
}
