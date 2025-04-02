# @dry-utils/text

HTML and Markdown conversion utilities with sanitization for safe rendering.

## Installation

```bash
npm install @dry-utils/text
```

## API

### markdownToHtml(markdown: string): string

Converts Markdown content to sanitized HTML.

### sanitizeHtmlContent(html: string): string

Sanitizes HTML content to allow safe rendering.

### standardizeUntrustedHtml(html: string): string

Standardizes untrusted HTML content by converting it to Markdown and then back to sanitized HTML.
