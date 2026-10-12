/**
 * Resume file -> text, entirely in the browser (nothing is uploaded).
 * pdf.js and mammoth are loaded only when someone picks a PDF or Word file.
 */

export type Extracted = { text: string; note?: string };

export class ExtractError extends Error {
  override name = "ExtractError";
}

const MAX_BYTES = 15 * 1024 * 1024;

export async function extractResumeText(file: File): Promise<Extracted> {
  if (file.size > MAX_BYTES) throw new ExtractError("That file is over 15 MB. A resume should be much smaller; try exporting it again.");
  const name = file.name.toLowerCase();
  if (/\.(md|markdown|txt)$/.test(name) || file.type.startsWith("text/")) return { text: await file.text() };
  if (name.endsWith(".pdf") || file.type === "application/pdf") return extractPdf(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".doc")) {
    throw new ExtractError("Old Word files (.doc) can't be read here. In Word, use File → Save As → .docx or PDF, then upload that.");
  }
  throw new ExtractError("Use a PDF, Word (.docx), Markdown or text file.");
}

// ---------- PDF ----------

type TextItem = { str: string; hasEOL?: boolean; transform: number[] };

async function extractPdf(file: File): Promise<Extracted> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const msg = (err as Error).name === "PasswordException" ? "This PDF is password-protected. Remove the password and try again." : "This PDF couldn't be opened. It may be damaged.";
    throw new ExtractError(msg);
  }

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(pageText(content.items as TextItem[]));
  }
  await task.destroy();

  const text = tidy(pages.join("\n\n"));
  if (text.replace(/\s/g, "").length < 80) {
    throw new ExtractError("This PDF has no selectable text. It's probably a scan or an image. Use “I have several resumes”: Claude and ChatGPT can read scanned PDFs.");
  }
  return {
    text,
    note: "Check the text below: PDFs with two columns or tables can come out in a mixed-up order. Fix anything odd before saving.",
  };
}

/** Rebuild lines from positioned text items: same baseline = same line. */
function pageText(items: TextItem[]): string {
  const lines: string[] = [];
  let line = "";
  let lastY: number | undefined;
  for (const item of items) {
    if (!("str" in item)) continue;
    const y = item.transform[5] ?? 0;
    if (lastY !== undefined && Math.abs(y - lastY) > 2 && line.trim()) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += item.str;
    lastY = y;
    if (item.hasEOL) {
      lines.push(line.trimEnd());
      line = "";
      lastY = undefined;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join("\n");
}

// ---------- Word (.docx) ----------

async function extractDocx(file: File): Promise<Extracted> {
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
  } catch {
    throw new ExtractError("This Word file couldn't be read. Try saving it again as .docx or exporting a PDF.");
  }
  const text = tidy(htmlToMarkdown(html));
  if (text.replace(/\s/g, "").length < 80) throw new ExtractError("This Word file looks empty, or its text is inside images.");
  return { text };
}

/** Just enough HTML -> Markdown for resumes: headings, lists, paragraphs, bold. */
function htmlToMarkdown(html: string): string {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const inline = (el: Element): string =>
    [...el.childNodes]
      .map((n) => {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
        const e = n as Element;
        const t = inline(e);
        if (e.tagName === "STRONG" || e.tagName === "B") return t.trim() ? `**${t.trim()}**` : t;
        if (e.tagName === "BR") return "\n";
        return t;
      })
      .join("");
  const walk = (el: Element, depth = 0) => {
    for (const child of [...el.children]) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) out.push(`${"#".repeat(Math.min(3, Number(tag[1])))} ${inline(child).trim()}`, "");
      else if (tag === "P") {
        const t = inline(child).trim();
        if (t) out.push(t, "");
      } else if (tag === "UL" || tag === "OL") {
        for (const li of [...child.children]) {
          const nested = [...li.children].filter((c) => c.tagName === "UL" || c.tagName === "OL");
          const own = li.cloneNode(true) as Element;
          own.querySelectorAll("ul,ol").forEach((n) => n.remove());
          out.push(`${"  ".repeat(depth)}- ${inline(own).trim()}`);
          for (const n of nested) walk(Object.assign(document.createElement("div"), { innerHTML: n.outerHTML }), depth + 1);
        }
        out.push("");
      } else if (tag === "TABLE") {
        for (const row of [...child.querySelectorAll("tr")]) {
          const cells = [...row.children].map((c) => inline(c).trim()).filter(Boolean);
          if (cells.length) out.push(cells.join(" · "));
        }
        out.push("");
      } else walk(child, depth);
    }
  };
  walk(dom.body);
  return out.join("\n");
}

function tidy(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
