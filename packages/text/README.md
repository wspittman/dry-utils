# dry-utils-text

HTML and Markdown conversion utilities with sanitization for safe rendering.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

Prerequisites:

- Node.js >=24.0.0

Install:

```bash
npm install dry-utils-text
```

## Features

- **Markdown to HTML**: Convert Markdown content to sanitized HTML using Showdown with sensible defaults (tables, GitHub-style headers, and indented sublist fixes).
- **HTML Sanitization**: Clean and sanitize HTML content for secure rendering while automatically locking down external links.
- **HTML Standardization**: Normalize untrusted HTML through a Markdown conversion cycle for consistent downstream rendering.
- **Configurable Pipelines**: Override Showdown or Turndown options when you need bespoke Markdown or HTML output.

## Usage

### Convert Markdown to HTML

Convert Markdown content to sanitized HTML with proper security measures. Pass Showdown converter options to customize the output:

```typescript
import { markdownToHtml } from "dry-utils-text";

const markdown = "# Hello World\n\nThis is **bold** and this is *italic*.";
const html = markdownToHtml(markdown);
// Results in: "<h1>Hello World</h1><p>This is <strong>bold</strong> and this is <em>italic</em>.</p>"
```

### Sanitize HTML Content

Safely clean HTML content to remove potentially dangerous elements:

```typescript
import { sanitizeHtmlContent } from "dry-utils-text";

const unsafeHtml = "<div>Safe content <script>alert('xss')</script></div>";
const safeHtml = sanitizeHtmlContent(unsafeHtml);
// Results in: "<div>Safe content </div>"
```

### Standardize Untrusted HTML

Process untrusted HTML by converting it to Markdown and back to sanitized HTML. You can override the Showdown or Turndown options used during the conversion cycle:

```typescript
import { standardizeUntrustedHtml } from "dry-utils-text";

const untrustedHtml =
  "<div style='dangerous-style'>Text with <script>badcode()</script></div>";
const standardizedHtml = standardizeUntrustedHtml(untrustedHtml);
// Results in sanitized, standardized HTML
```

### Security Features

- External links automatically get `target="_blank"` and `rel="noopener noreferrer"` attributes
- Dangerous HTML elements and attributes are stripped using `sanitize-html`'s default allowlists with extra link hardening
- HTML entities are properly decoded before sanitization to avoid double-encoding issues
