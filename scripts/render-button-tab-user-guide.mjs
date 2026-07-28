import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const input = path.join(root, "docs", "Adamrit-HRPulse-Button-Tab-User-Guide.md");
const htmlOutput = path.join(root, "docs", "Adamrit-HRPulse-Button-Tab-User-Guide.html");

const markdown = fs.readFileSync(input, "utf8");

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  for (const line of lines) {
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
  closeList();
  return html.join("\n");
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Adamrit HRPulse Button and Tab User Guide</title>
  <style>
    @page { size: A4; margin: 17mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111827;
      background: white;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.55;
    }
    h1 {
      margin: 0 0 14px;
      padding: 24px;
      border-radius: 18px;
      color: #f8fafc;
      background: #0f172a;
      font-size: 25px;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    h2 {
      margin: 22px 0 8px;
      padding: 8px 10px;
      border-left: 4px solid #3b82f6;
      border-radius: 8px;
      color: #0f172a;
      background: #f1f5f9;
      font-size: 16px;
      page-break-after: avoid;
    }
    h3 {
      margin: 16px 0 7px;
      color: #1e293b;
      font-size: 13px;
      page-break-after: avoid;
    }
    h4 {
      margin: 12px 0 6px;
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
      font-size: 10px;
    }
    .step {
      margin: 4px 0 4px 14px;
      color: #334155;
    }
  </style>
</head>
<body>${renderMarkdown(markdown)}</body>
</html>`;

fs.writeFileSync(htmlOutput, html, "utf8");
console.log(htmlOutput);
