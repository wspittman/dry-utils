import { decode } from "html-entities";
import sanitizeHtml from "sanitize-html";
import Showdown from "showdown";
import TurndownService from "turndown";

const defaultShowdownOptions: Showdown.ConverterOptions = {
  tables: true,
  disableForced4SpacesIndentedSublists: true,
  ghCompatibleHeaderId: true,
};

/**
 * Standardizes untrusted HTML content by converting it to Markdown and then back to sanitized HTML.
 * @param html - The untrusted HTML content
 * @param converterOptions - Optional Showdown converter options to apply or override defaults
 * @param turndownOptions - Optional Turndown options to configure markdown conversion
 * @returns The standardized HTML content
 */
export function standardizeUntrustedHtml(
  html: string,
  converterOptions?: Showdown.ConverterOptions,
  turndownOptions?: TurndownService.Options,
): string {
  const decoded = decode(html);
  const sanitized = sanitizeHtmlContent(decoded);

  const turndownService = new TurndownService(turndownOptions);
  const markdown = turndownService.turndown(sanitized);

  return markdownToHtml(markdown, converterOptions);
}

/**
 * Converts Markdown content to sanitized HTML.
 * @param markdown - The Markdown content
 * @param options - Optional Showdown converter options to apply or override defaults
 * @returns The sanitized HTML content
 */
export function markdownToHtml(
  markdown: string,
  options?: Showdown.ConverterOptions,
): string {
  const converter = new Showdown.Converter({
    ...defaultShowdownOptions,
    ...options,
  });
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
