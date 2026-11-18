// Dossier builder for token-radar-01 (makefun/dossier/v1).
//
// My own implementation of the dossier contract the scorer checks: given an
// output directory holding dashboard/ and screenshots/, produce the canonical
// JSON dossier the judge reads. The scorer rebuilds the same bytes from the
// same inputs, so this file must agree with the contract exactly:
//
//   dossier = { schema, cover, text, images } as canonical JSON (keys sorted,
//   no whitespace), where cover is 0, images are the screenshots in name
//   order with their media type, sha256 and base64, and text is a
//   "## Dashboard" block followed by "## Source" sections, capped at
//   caps.text_max_bytes UTF-8 bytes with the cut rule below.
//
// The text cap is the only cap that shapes bytes; the screenshot and
// dashboard caps only refuse. Text shows every dashboard source file whole
// in path order while it fits; the first file that does not fit whole is
// shown up to its last complete line that fits, with a line saying how many
// of its lines are not shown; nothing follows but a last line naming how many
// whole files and bytes were left out. Files whose extension is not one of
// .html .css .js .json .mjs .svg .md .txt are listed in the Dashboard block
// and never shown.
//
// Usage from main.ts:
//   import { buildDossier } from './vendor/makefun-board.ts';
//   writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65536 }));

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DOSSIER_SCHEMA = 'makefun/dossier/v1';
export const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
export const DOSSIER_MAX_IMAGES = 8;

const NAME_OK = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SHOWN_EXT = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_HEAD = [0xff, 0xd8, 0xff];

export interface DossierCaps {
  text_max_bytes: number;
  screenshots?: { max: number; max_bytes: number };
  dashboard?: { max_files: number; max_bytes: number };
}

export class DossierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DossierError';
  }
}

function fail(msg: string): never {
  throw new DossierError(msg);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function utf8len(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function startsWith(bytes: Uint8Array, head: number[]): boolean {
  if (bytes.length < head.length) return false;
  for (let i = 0; i < head.length; i++) if (bytes[i] !== head[i]) return false;
  return true;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical JSON: object keys in code-unit order, no whitespace at all. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} is not finite`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('canonicalJson: only plain objects and arrays');
    }
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort(compareStrings)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`);
}

/** Read a regular file, refusing links and anything over `cap` bytes. */
function readPlain(path: string, cap: number, what: string): Buffer {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    fail(`buildDossier: ${what} cannot be read`);
  }
  if (!st!.isFile()) fail(`buildDossier: ${what} is not a regular file`);
  if (st!.size > cap) fail(`buildDossier: ${what} is ${st!.size} bytes, over the ${cap} a dossier reads`);
  let data: Buffer;
  try {
    data = readFileSync(path);
  } catch {
    fail(`buildDossier: ${what} cannot be read`);
  }
  if (data!.length > cap) fail(`buildDossier: ${what} is ${data!.length} bytes, over the ${cap} a dossier reads`);
  return data!;
}

interface DashEntry {
  path: string;
  size: number;
}

/** Every regular file under the dashboard tree, in path order. */
function listDashboard(root: string, caps: { max_files: number; max_bytes: number } | null): DashEntry[] {
  let st;
  try {
    st = lstatSync(root);
  } catch {
    fail('buildDossier: no dashboard/ directory: the page and its source are what the judge reads');
  }
  if (!st!.isDirectory()) fail('buildDossier: dashboard is not a directory');
  const found: DashEntry[] = [];
  let total = 0;
  const walk = (rel: string): void => {
    const dir = rel === '' ? root : join(root, rel);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          fail(`buildDossier: dashboard/${p} is a dot-directory`);
        }
        walk(p);
      } else if (entry.isFile()) {
        if (!NAME_OK.test(entry.name)) {
          fail(`buildDossier: dashboard/${p}: a file's name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
        }
        const size = lstatSync(join(root, p)).size;
        found.push({ path: p, size });
        total += size;
        if (caps !== null && found.length > caps.max_files) {
          fail(`buildDossier: dashboard/ holds more than the ${caps.max_files} files it may`);
        }
        if (caps !== null && total > caps.max_bytes) {
          fail(`buildDossier: dashboard/'s files come to more than the ${caps.max_bytes} bytes they may`);
        }
      } else {
        fail(`buildDossier: dashboard/${p} is neither a file nor a directory`);
      }
    }
  };
  walk('');
  return found.sort((a, b) => compareStrings(a.path, b.path));
}

function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return bytes[bytes.length - 1] === 0x0a ? n : n + 1;
}

function fenceFor(body: string): string {
  let longest = 0;
  const runs = body.match(/`+/g) ?? [];
  for (const run of runs) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenceLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  return ext === 'mjs' ? 'js' : ext;
}

interface ShownSection {
  heading: string;
  headingBytes: number;
  block: string | null;
  blockBytes: number;
  fileBytes: number;
  lines: number;
  raw: Buffer | null;
}

/**
 * Build the dossier of `dir` (its dashboard/ and screenshots/) as canonical
 * JSON bytes. Throws DossierError when a cap cannot be kept.
 */
export function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const textCap = caps.text_max_bytes;
  if (!Number.isSafeInteger(textCap) || textCap <= 0) {
    fail(`buildDossier: caps.text_max_bytes must be a positive integer, not ${String(textCap)}`);
  }

  let imageLimit = DOSSIER_MAX_IMAGES;
  let imageBytesLimit = DOSSIER_MAX_BYTES;
  if (caps.screenshots !== undefined) {
    const s = caps.screenshots;
    if (typeof s !== 'object' || s === null) fail('buildDossier: caps.screenshots must be an object {max, max_bytes}');
    for (const key of ['max', 'max_bytes'] as const) {
      const v = (s as Record<string, unknown>)[key];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
        fail(`buildDossier: caps.screenshots.${key} must be a positive integer, not ${String(v)}`);
      }
    }
    if (s.max < imageLimit) imageLimit = s.max;
    if (s.max_bytes < imageBytesLimit) imageBytesLimit = s.max_bytes;
  }

  let dashCaps: { max_files: number; max_bytes: number } | null = null;
  if (caps.dashboard !== undefined) {
    const d = caps.dashboard;
    if (typeof d !== 'object' || d === null) fail('buildDossier: caps.dashboard must be an object {max_files, max_bytes}');
    for (const key of ['max_files', 'max_bytes'] as const) {
      const v = (d as Record<string, unknown>)[key];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
        fail(`buildDossier: caps.dashboard.${key} must be a positive integer, not ${String(v)}`);
      }
    }
    dashCaps = { max_files: d.max_files, max_bytes: d.max_bytes };
  }

  const files = listDashboard(join(dir, 'dashboard'), dashCaps);

  const shotsDir = join(dir, 'screenshots');
  let shotNames: string[];
  try {
    shotNames = readdirSync(shotsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort(compareStrings);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      fail('buildDossier: no screenshots/ directory: the first screenshot is the cover');
    }
    fail('buildDossier: screenshots/ cannot be read');
  }
  if (shotNames.length === 0) fail('buildDossier: screenshots/ holds no image: the first is the cover');
  if (shotNames.length > imageLimit) {
    fail(`buildDossier: screenshots/ holds ${shotNames.length} files, over the ${imageLimit} a dossier holds`);
  }
  const images = shotNames.map((name) => {
    if (!NAME_OK.test(name)) {
      fail(`buildDossier: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
    }
    const bytes = readPlain(join(shotsDir, name), imageBytesLimit, `screenshots/${name}`);
    const mediaType = startsWith(bytes, PNG_HEAD)
      ? 'image/png'
      : startsWith(bytes, JPG_HEAD)
        ? 'image/jpeg'
        : null;
    if (mediaType === null) fail(`buildDossier: screenshots/${name} is neither a PNG nor a JPEG`);
    return { name, media_type: mediaType, sha256: sha256(bytes), base64: bytes.toString('base64') };
  });

  const headLines = [
    '## Dashboard',
    '',
    `Files: ${files.length} (${files.reduce((n, f) => n + f.size, 0)} bytes)`,
    ...files.map((f) => `- ${f.path} (${f.size} bytes)`),
    '',
    '## Source',
    '',
    '',
  ];
  const head = headLines.join('\n');

  const shownFiles = files.filter((f) => SHOWN_EXT.test(f.path));
  const sections: ShownSection[] = shownFiles.map((f) => {
    const raw = readPlain(join(dir, 'dashboard', f.path), DOSSIER_MAX_BYTES, `dashboard/${f.path}`);
    const lines = countLines(raw);
    const heading = `### ${f.path}\n\n${raw.length} bytes, ${lines} line${lines === 1 ? '' : 's'}\n\n`;
    if (raw.length === 0) {
      return { heading, headingBytes: utf8len(heading), block: null, blockBytes: 0, fileBytes: 0, lines, raw: null };
    }
    const text = new TextDecoder('utf-8').decode(raw);
    const fence = fenceFor(text);
    const lang = fenceLanguage(f.path);
    const block = `${fence}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    return { heading, headingBytes: utf8len(heading), block, blockBytes: utf8len(block), fileBytes: raw.length, lines, raw };
  });

  // Bytes of shown files after each section, for the cut line's totals:
  // afterBytes[k] is the sum of the file bytes of sections k+1..end, so the
  // cut line after section k can name everything still left out.
  const afterBytes = new Array<number>(sections.length + 1).fill(0);
  for (let k = sections.length - 1; k >= 0; k--) {
    afterBytes[k] = afterBytes[k + 1]! + (k + 1 < sections.length ? sections[k + 1]!.fileBytes : 0);
  }
  const cutLine = (count: number, bytes: number): string =>
    `[Cut at ${textCap} bytes: ${count} file${count === 1 ? '' : 's'} and ${bytes} bytes left out.]\n`;

  let out = head;
  let used = utf8len(head);
  if (used + utf8len(cutLine(0, 0)) > textCap) {
    fail(`buildDossier: caps.text_max_bytes ${textCap} cannot hold even the Dashboard block and the cut line`);
  }

  let kept = 0;
  for (; kept < sections.length; kept++) {
    const section = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const tail = restCount === 0 ? 0 : utf8len(cutLine(restCount, afterBytes[kept]!));
    const size = section.headingBytes + section.blockBytes;
    if (used + size + tail > textCap) break;
    out += section.block === null ? section.heading : `${section.heading}${section.block}`;
    used += size;
  }

  if (kept < sections.length) {
    const first = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const after = afterBytes[kept]!;
    const room = textCap - used;
    const partial = cutSectionHead(first, room, (hidden) => cutLine(restCount, after + hidden));
    out += partial ?? cutLine(restCount + 1, after + first.fileBytes);
  }
  if (utf8len(out) > textCap) {
    fail(`buildDossier: caps.text_max_bytes ${textCap} cannot hold even the Dashboard block and the cut line`);
  }

  const doc = { schema: DOSSIER_SCHEMA, cover: 0, text: out.replace(/\n+$/, '\n'), images };
  const bytes = Buffer.from(canonicalJson(doc), 'utf8');
  if (bytes.length > DOSSIER_MAX_BYTES) {
    fail(`buildDossier: the dossier is ${bytes.length} bytes, over the ${DOSSIER_MAX_BYTES} one holds`);
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/**
 * The first section that does not fit whole, cut inside its contents: its
 * heading, its first k lines inside its fence (closed), a line naming how
 * many of its lines are not shown, then the cut line for the bytes this file
 * leaves out. k is the most lines (at least one, fewer than all) that fit in
 * `room`; null when not even one line fits. Cutting only after a line's LF
 * never splits a UTF-8 sequence.
 */
function cutSectionHead(
  section: ShownSection,
  room: number,
  tail: (hidden: number) => string,
): string | null {
  if (section.block === null || section.raw === null) return null;
  const raw = section.raw;
  const text = new TextDecoder('utf-8').decode(raw);
  const total = section.lines;
  const lines = text.split('\n');
  // The fence opening, taken from the block itself, so the language matches.
  const blockOpen = section.block.slice(0, section.block.indexOf('\n') + 1);
  const fence = fenceFor(text);
  const close = `${fence}\n\n`;
  const note = (k: number): string => `[${total - k} of this file's ${total} lines not shown.]\n`;
  const fixed = section.headingBytes + utf8len(blockOpen) + utf8len(close);
  let best = 0;
  let shown = 0;
  let rawAt = 0;
  for (let k = 1; k < total; k++) {
    shown += utf8len(lines[k - 1]!) + 1;
    rawAt = raw.indexOf(0x0a, rawAt) + 1;
    if (fixed + shown + utf8len(note(k)) + utf8len(tail(raw.length - rawAt)) <= room) best = k;
  }
  if (best === 0) return null;
  let rawEnd = 0;
  for (let k = 0; k < best; k++) rawEnd = raw.indexOf(0x0a, rawEnd) + 1;
  const headText = lines.slice(0, best).map((l) => `${l}\n`).join('');
  return `${section.heading}${blockOpen}${headText}${close}${note(best)}${tail(raw.length - rawEnd)}`;
}
