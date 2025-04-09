# @dry-utils/text

HTML and Markdown conversion utilities with sanitization for safe rendering.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

```bash
npm install @dry-utils/text
```

## Features

- **Markdown to HTML**: Convert Markdown content to sanitized HTML
- **HTML Sanitization**: Clean and sanitize HTML content for secure rendering
- **HTML Standardization**: Normalize untrusted HTML through a Markdown conversion cycle

## Usage

### Convert Markdown to HTML

Convert Markdown content to sanitized HTML with proper security measures:

```typescript
import { markdownToHtml } from "@dry-utils/text";

const markdown = "# Hello World\n\nThis is **bold** and this is *italic*.";
const html = markdownToHtml(markdown);
// Results in: "<h1>Hello World</h1><p>This is <strong>bold</strong> and this is <em>italic</em>.</p>"
```

### Sanitize HTML Content

Safely clean HTML content to remove potentially dangerous elements:

```typescript
import { sanitizeHtmlContent } from "@dry-utils/text";

const unsafeHtml = "<div>Safe content <script>alert('xss')</script></div>";
const safeHtml = sanitizeHtmlContent(unsafeHtml);
// Results in: "<div>Safe content </div>"
```

### Standardize Untrusted HTML

Process untrusted HTML by converting it to Markdown and back to sanitized HTML:

```typescript
import { standardizeUntrustedHtml } from "@dry-utils/text";

const untrustedHtml =
  "<div style='dangerous-style'>Text with <script>badcode()</script></div>";
const standardizedHtml = standardizeUntrustedHtml(untrustedHtml);
// Results in sanitized, standardized HTML
```

### Security Features

- External links automatically get `target="_blank"` and `rel="noopener noreferrer"` attributes
- Dangerous HTML elements and attributes are stripped
- HTML entities are properly decoded

## Requirements

- Node.js >=22.0.0
