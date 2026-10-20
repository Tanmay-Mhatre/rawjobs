/** RFC 4180 CSV: quotes, "" escapes, commas and line breaks inside quotes, CRLF or LF, a leading BOM. */

export type CsvLimits = {
  /** Stop after this many rows (header and preamble lines count). */
  maxRows?: number;
  /** Longer fields are clipped to this many characters. */
  maxField?: number;
};

export function parseCsv(text: string, { maxRows = Number.POSITIVE_INFINITY, maxField = 200 }: CsvLimits = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const push = () => {
    row.push(field.length > maxField ? field.slice(0, maxField) : field);
    field = "";
  };
  const endRow = () => {
    push();
    rows.push(row);
    row = [];
  };
  for (; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") push();
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
    // A runaway field (an unclosed quote) can't grow past what it may keep.
    if (field.length > maxField + 1) field = field.slice(0, maxField + 1);
  }
  if (rows.length < maxRows && (field !== "" || row.length)) endRow();
  return rows;
}

/** A header row and where each of its columns is, by trimmed lower-case name. */
export type CsvHeader = { index: number; col: (name: string) => number };

/**
 * The first row with every `required` column (case-insensitive, trimmed), skipping LinkedIn's
 * "Notes:" preamble and comma-only blank rows. Null when there's none.
 */
export function findHeader(rows: string[][], required: readonly string[]): CsvHeader | null {
  for (let index = 0; index < rows.length; index++) {
    const names = rows[index]!.map((c) => c.trim().toLowerCase());
    if (required.every((r) => names.includes(r.toLowerCase()))) return { index, col: (name) => names.indexOf(name.toLowerCase()) };
  }
  return null;
}
