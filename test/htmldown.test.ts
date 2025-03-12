import { encode } from "html-entities";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  markdownToHtml,
  sanitizeHtmlContent,
  standardizeUntrustedHtml,
} from "../src/htmldown";

const html = {
  text: "Text",
  p: "<p>Text</p>",
  bold: "<p>Bold <strong>Text</strong></p>",
  headers: "<h1>Header 1</h1>\n<h2>Header 2</h2>",
  headersWithId:
    '<h1 id="header1">Header 1</h1>\n<h2 id="header2">Header 2</h2>',
  list: "<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n</ul>",
  codeBlock: "<pre><code>code block\n</code></pre>",
  codeInline: "<p>This is <code>inline code</code></p>",
  linkEmpty: "<a>Text</a>",
  linkHref: '<a href="https://example.com">Text</a>',
  linkSelf: '<a href="https://example.com" target="_self">Text</a>',
  link: '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Text</a>',
  script: "<p>Text</p><script>alert('xss')</script>",
  disallowedAttributes: "<p onclick=\"alert('xss')\">Text</p>",
  disallowedTags: '<p>Text</p><iframe src="https://evil.com"></iframe>',
};

const markdown = {
  text: "Text",
  bold: "Bold **Text**",
  headers: "# Header 1\n## Header 2",
  list: "- Item 1\n- Item 2",
  codeBlock: "```\ncode block\n```",
  codeInline: "This is `inline code`",
  link: "[Text](https://example.com)",
  scriptInjection: "[Text](javascript:alert('xss'))",
};

describe("HtmlDown: sanitizeHtmlContent", () => {
  const cases: [keyof typeof html, string][] = [
    ["text", html.text],
    ["p", html.p],
    ["bold", html.bold],
    ["headers", html.headers],
    ["headersWithId", html.headers],
    ["list", html.list],
    ["codeBlock", html.codeBlock],
    ["codeInline", html.codeInline],
    ["linkEmpty", html.linkEmpty],
    ["linkHref", html.link],
    ["linkSelf", html.link],
    ["link", html.link],
    ["script", html.p],
    ["disallowedAttributes", html.p],
    ["disallowedTags", html.p],
  ];

  cases.forEach(([name, expected]) => {
    test(`sanitizeHtmlContent: ${name}`, () => {
      const result = sanitizeHtmlContent(html[name]);
      assert.equal(result, expected);
    });
  });
});

describe("HtmlDown: markdownToHtml", () => {
  const cases: [keyof typeof markdown, string][] = [
    ["text", html.p],
    ["bold", html.bold],
    ["headers", html.headers],
    ["list", html.list],
    ["codeBlock", html.codeBlock],
    ["codeInline", html.codeInline],
    ["link", `<p>${html.link}</p>`],
    ["scriptInjection", `<p>${html.linkEmpty}</p>`],
  ];

  cases.forEach(([name, expected]) => {
    test(`markdownToHtml: ${name}`, () => {
      const result = markdownToHtml(markdown[name]);
      assert.equal(result, expected);
    });
  });
});

describe("HtmlDown: standardizeUntrustedHtml", () => {
  const cases: [keyof typeof html, string][] = [
    ["text", html.p],
    ["p", html.p],
    ["bold", html.bold],
    ["headers", html.headers],
    ["headersWithId", html.headers],
    ["list", html.list],
    ["codeBlock", html.codeBlock],
    ["codeInline", html.codeInline],
    ["linkEmpty", html.p],
    ["linkHref", `<p>${html.link}</p>`],
    ["linkSelf", `<p>${html.link}</p>`],
    ["link", `<p>${html.link}</p>`],
    ["script", html.p],
    ["disallowedAttributes", html.p],
    ["disallowedTags", html.p],
  ];

  cases.forEach(([name, expected]) => {
    test(`standardizeUntrustedHtml: ${name}`, () => {
      const result = standardizeUntrustedHtml(encode(html[name]));
      assert.equal(result, expected);
    });
  });
});
