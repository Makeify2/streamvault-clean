import axios from 'axios';
import { getDownloadLink, TorBoxFile } from '../services/torbox';

const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa'];

/**
 * Converts SRT subtitle content to WebVTT format.
 */
export function convertSrtToVtt(srtContent: string): string {
  if (!srtContent) return 'WEBVTT\n\n';

  // Strip BOM and normalize line endings
  let body = srtContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Replace comma decimal separators in timestamps: 00:00:00,000 -> 00:00:00.000
  // Also tolerate 1-digit hours by padding them.
  body = body.replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/g, (_m, h, m, s, ms) =>
    `${h.padStart(2, '0')}:${m}:${s}.${ms}`
  );

  // SRT alignment tags like {\an8} are not valid VTT — drop them
  body = body.replace(/\{\\an\d\}/gi, '');

  return 'WEBVTT\n\n' + body.trim() + '\n';
}

/**
 * Converts ASS/SSA subtitle content to WebVTT. Styling is dropped; text and timing are kept.
 */
export function convertAssToVtt(assContent: string): string {
  if (!assContent) return 'WEBVTT\n\n';

  const lines = assContent.replace(/^﻿/, '').split(/\r?\n/);

  // Locate the Events format definition so we can find Start/End/Text columns
  let format: string[] | null = null;
  const cues: Array<{ start: number; end: number; text: string }> = [];

  const toMs = (t: string): number => {
    // ASS timestamps: H:MM:SS.cc (centiseconds)
    const m = t.trim().match(/(\d+):(\d{2}):(\d{2})[.,](\d{2})/);
    if (!m) return NaN;
    return (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000 + parseInt(m[4], 10) * 10;
  };

  for (const line of lines) {
    const fmtMatch = line.match(/^Format\s*:\s*(.+)$/i);
    if (fmtMatch) {
      format = fmtMatch[1].split(',').map(f => f.trim().toLowerCase());
      continue;
    }
    const diaMatch = line.match(/^Dialogue\s*:\s*(.+)$/i);
    if (!diaMatch) continue;

    const cols = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const textIdx = cols.indexOf('text');
    const startIdx = cols.indexOf('start');
    const endIdx = cols.indexOf('end');
    if (textIdx === -1 || startIdx === -1 || endIdx === -1) continue;

    // Text is the last column and may itself contain commas
    const parts = diaMatch[1].split(',');
    if (parts.length <= textIdx) continue;
    const start = toMs(parts[startIdx]);
    const end = toMs(parts[endIdx]);
    if (isNaN(start) || isNaN(end)) continue;

    let text = parts.slice(textIdx).join(',');
    text = text
      .replace(/\{[^}]*\}/g, '')      // style override blocks {\i1}, {\pos(...)}, ...
      .replace(/\\N/gi, '\n')          // hard line breaks
      .replace(/\\h/g, ' ')            // hard spaces
      .trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  cues.sort((a, b) => a.start - b.start);

  const fmt = (ms: number): string => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
  };

  let vtt = 'WEBVTT\n\n';
  for (const cue of cues) {
    vtt += `${fmt(cue.start)} --> ${fmt(cue.end)}\n${cue.text}\n\n`;
  }
  return vtt;
}

export interface SubtitleCandidate {
  id: number;
  name: string;
  size: number;
  lang: string; // Human-readable language (e.g. 'English', 'Spanish', or 'Default')
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', eng: 'English', english: 'English',
  es: 'Spanish', spa: 'Spanish', spanish: 'Spanish', latino: 'Spanish (Latino)',
  fr: 'French', fre: 'French', fra: 'French', french: 'French',
  de: 'German', ger: 'German', deu: 'German', german: 'German',
  it: 'Italian', ita: 'Italian', italian: 'Italian',
  pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese', brazilian: 'Portuguese (BR)',
  nl: 'Dutch', nld: 'Dutch', dut: 'Dutch', dutch: 'Dutch',
  ru: 'Russian', rus: 'Russian', russian: 'Russian',
  zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', chinese: 'Chinese',
  ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese',
  ko: 'Korean', kor: 'Korean', korean: 'Korean',
  ar: 'Arabic', ara: 'Arabic', arabic: 'Arabic',
  hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
  tr: 'Turkish', tur: 'Turkish', turkish: 'Turkish',
  pl: 'Polish', pol: 'Polish', polish: 'Polish',
  sv: 'Swedish', swe: 'Swedish', swedish: 'Swedish',
  no: 'Norwegian', nor: 'Norwegian', norwegian: 'Norwegian',
  da: 'Danish', dan: 'Danish', danish: 'Danish',
  fi: 'Finnish', fin: 'Finnish', finnish: 'Finnish',
  cs: 'Czech', cze: 'Czech', czech: 'Czech',
  el: 'Greek', gre: 'Greek', greek: 'Greek',
  he: 'Hebrew', heb: 'Hebrew', hebrew: 'Hebrew',
  th: 'Thai', tha: 'Thai', thai: 'Thai',
  vi: 'Vietnamese', vie: 'Vietnamese', vietnamese: 'Vietnamese',
  id: 'Indonesian', ind: 'Indonesian', indonesian: 'Indonesian',
  ro: 'Romanian', rum: 'Romanian', romanian: 'Romanian',
  hu: 'Hungarian', hun: 'Hungarian', hungarian: 'Hungarian',
  uk: 'Ukrainian', ukr: 'Ukrainian', ukrainian: 'Ukrainian',
  sdh: 'English (SDH)', forced: 'Forced'
};

/**
 * Detects language from a subtitle filename, e.g. "Movie.en.srt", "Subs/2_English.srt",
 * "Movie - English (SDH).srt".
 */
export function detectLanguage(filePath: string): string {
  const base = (filePath.split('/').pop() || filePath)
    .replace(/\.(srt|vtt|ass|ssa)$/i, '')
    .toLowerCase();

  // Tokenize on common separators and scan from the end (lang tags trail the name)
  const tokens = base.split(/[._\-\s()\[\]]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const hit = LANG_NAMES[tokens[i]];
    if (hit) return hit;
  }

  return 'Default';
}

/**
 * Scans a list of files in a torrent to identify subtitle files.
 */
export function getSubtitleFiles(files: TorBoxFile[]): SubtitleCandidate[] {
  return files
    .filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return !!ext && SUBTITLE_EXTENSIONS.includes(ext);
    })
    .map(file => ({
      id: file.id,
      name: file.name,
      size: file.size,
      lang: detectLanguage(file.name)
    }));
}

/** Decodes a raw subtitle buffer, handling UTF-16 BOMs. */
function decodeSubtitleBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    // UTF-16 BE: swap byte pairs, then decode as LE (Node has no native utf16be)
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf-8');
}

/**
 * Downloads a subtitle file from TorBox, converts it to WebVTT if necessary, and returns the content.
 */
export async function fetchAndConvertSubtitle(torrentId: number | string, fileId: number | string, filename: string): Promise<string> {
  const cdnLink = await getDownloadLink(torrentId, fileId);

  const response = await axios.get(cdnLink, {
    responseType: 'arraybuffer',
    timeout: 20000,
    // A subtitle file is small. Without a cap, a caller could point this at a large file in
    // the owner's library and have the process buffer the whole thing in RAM.
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024
  });

  const content = decodeSubtitleBuffer(Buffer.from(response.data));
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'ass' || ext === 'ssa') {
    return convertAssToVtt(content);
  }
  if (ext === 'vtt' || content.trimStart().startsWith('WEBVTT')) {
    return content.replace(/^﻿/, '');
  }
  return convertSrtToVtt(content);
}
