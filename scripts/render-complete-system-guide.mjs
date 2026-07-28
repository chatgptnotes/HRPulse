import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const input = path.join(root, "docs", "Adamrit-HRPulse-Complete-System-Guide.md");
const htmlOutput = path.join(root, "docs", "Adamrit-HRPulse-Complete-System-Guide.html");
const pdfOutput = path.join(root, "docs", "Adamrit-HRPulse-Complete-System-Guide.pdf");

const markdown = fs.readFileSync(input, "utf8");

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(source) {
  const lines = source.split(/\r?\n/);
  const html = [];
  let listOpen = false;
  let codeOpen = false;
  let code = [];

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  function closeCode() {
    if (codeOpen) {
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      code = [];
      codeOpen = false;
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (codeOpen) closeCode();
      else {
        closeList();
        codeOpen = true;
      }
      continue;
    }
    if (codeOpen) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      closeList();
      html.push(`<p class="step">${inline(ordered[1])}</p>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeCode();
  closeList();
  return html.join("\n");
}

const body = renderMarkdown(markdown);
const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Adamrit HRPulse Complete System Guide</title>
  <style>
    @page { size: A4; margin: 17mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111827;
      background: #ffffff;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      font-size: 10.5px;
      line-height: 1.52;
    }
    h1 {
      margin: 0 0 12px;
      padding: 22px 24px;
      border-radius: 18px;
      color: #f8fafc;
      background: #0f172a;
      font-size: 25px;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    h2 {
      margin: 22px 0 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid #dbe3ef;
      color: #0f172a;
      font-size: 16px;
      page-break-after: avoid;
    }
    h3 {
      margin: 16px 0 7px;
      color: #1e293b;
      font-size: 12.5px;
      page-break-after: avoid;
    }
    h4 {
      margin: 13px 0 6px;
      color: #334155;
      font-size: 12px;
      page-break-after: avoid;
    }
    p { margin: 5px 0; }
    ul { margin: 5px 0 9px 18px; padding: 0; }
    li { margin: 2px 0; }
    code {
      padding: 1px 4px;
      border-radius: 5px;
      color: #0f172a;
      background: #eef2ff;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 9.5px;
    }
    pre {
      margin: 7px 0;
      padding: 9px;
      border: 1px solid #dbe3ef;
      border-radius: 12px;
      background: #f8fafc;
      white-space: pre-wrap;
      page-break-inside: avoid;
    }
    pre code { padding: 0; background: transparent; }
    .step {
      margin: 4px 0 4px 14px;
      color: #334155;
    }
  </style>
</head>
<body>${body}</body>
</html>`;

fs.writeFileSync(htmlOutput, html, "utf8");

const requireFromAdamrit = createRequire(path.join(root, "adamrit", "package.json"));
let chromium = requireFromAdamrit("playwright").chromium;
if (!chromium) chromium = requireFromAdamrit("@playwright/test").chromium;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlOutput).href, { waitUntil: "load" });
await page.pdf({
  path: pdfOutput,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: "<div style='width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:9px;color:#64748b;padding:0 15mm;display:flex;justify-content:space-between;'><span>Adamrit HRPulse Complete System Guide</span><span><span class='pageNumber'></span> / <span class='totalPages'></span></span></div>",
  margin: { top: "17mm", right: "15mm", bottom: "17mm", left: "15mm" },
});
await browser.close();

console.log(pdfOutput);
