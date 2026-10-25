export interface ParsedMedia {
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  type: 'movie' | 'tv';
  /** False when the torrent looks like a game/software/music release rather than a film or show. */
  isMedia: boolean;
}

// Known media container / subtitle extensions we strip from the end of names.
const KNOWN_EXTENSIONS = /\.(mp4|mkv|webm|avi|mov|m4v|flv|wmv|ts|m2ts|mpg|mpeg|ogv|srt|ass|ssa|vtt|sub|idx)$/i;

// Release tags that mark the end of the actual title.
const STOP_WORDS = [
  's\\d+\\s*e\\d+(?:-e?\\d+)?',
  '\\d+x\\d+',
  'season\\s*\\d+(?:\\s*-\\s*\\d+)?',
  'seasons?\\s*\\d+\\s*\\d*',
  's\\d+(?:\\s*-\\s*s?\\d+)?',
  '19\\d{2}',
  '20\\d{2}',
  '2160p', '1440p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd',
  'web[ -]?dl', 'webrip', 'bluray', 'blu[ -]?ray', 'bdrip', 'brrip', 'bdmv',
  'dvdrip', 'hdtv', 'hdrip', 'camrip', 'hdcam', 'telesync', 'remux', 'bd',
  'h\\s?264', 'x\\s?264', 'h\\s?265', 'x\\s?265', 'hevc', 'avc', 'av1', 'xvid', 'divx',
  '10\\s?bit', '8\\s?bit', 'hdr10?(?:\\+)?', 'dolby\\s*vision', '\\bdv\\b', 'sdr',
  'ddp?\\s?[257]\\s?[01]?', 'dts(?:-?hd)?', 'ac3', 'eac3', 'aac(?:\\s?2\\s?0)?', 'flac', 'opus', 'mp3',
  'truehd', 'atmos', '[257]\\s?1ch', 'dual[ -]?audio', 'multi[ -]?(?:audio|sub|lang)?',
  'uncensored', 'uncut', 'extended', 'remastered', 'theatrical', 'directors\\s*cut', 'imax',
  'proper', 'repack', 'internal', 'limited', 'complete(?:\\s*(?:series|season|batch))?', 'batch',
  'subbed', 'dubbed', 'eng(?:lish)?\\s*(?:sub|dub)s?', 'esub', 'msubs?', 'vostfr',
  'amzn', 'nf', 'dsnp', 'hulu', 'hmax', 'atvp', 'crav', 'cr\\b',
  'rarbg', 'yify', 'yts(?:\\s?(?:mx|am|lt))?', 'ettv', 'eztv', 'galaxytv', 'sample'
];

// Markers that strongly suggest the torrent is software / a game, not a movie or show.
const NON_MEDIA_MARKERS = [
  /\bfitgirl\b/i, /\bdodi\b/i, /\brepack\b/i, /\bgog\b/i, /\bcodex\b/i, /\bskidrow\b/i,
  /\bplaza\b/i, /\bempress\b/i, /\brazor1911\b/i, /\btenoke\b/i, /\brune\b/i, /\bflt\b/i,
  /\bkeygen\b/i, /\bcrackfix\b/i, /\bpre-?installed\b/i, /\bportable\b/i,
  /\bsetup\b/i, /\binstaller\b/i, /\bactivat(?:or|ed|ion)\b/i,
  /\bwin(?:32|64)\b/i, /\bx(?:64|86)\b/i, /\bmacos\b/i, /\blinux\b/i, /\bapk\b/i, /\bmsi\b/i,
  /\bv\d+\.\d+\.\d+/i, /\bbuild\s?\d{3,}\b/i,
  /\bdiscography\b/i, /\b320\s?kbps\b/i, /\bvst\b/i, /\bplugins?\s+(?:bundle|pack)\b/i,
  /\b(?:adobe|autodesk|ableton|microsoft\s+office|windows\s+1[01])\b/i
];

function looksLikeNonMedia(name: string): boolean {
  return NON_MEDIA_MARKERS.some(rx => rx.test(name));
}

/**
 * Parses torrent or file names to extract title, year, season, and episode.
 */
export function parseMediaName(filename: string): ParsedMedia {
  const isMedia = !looksLikeNonMedia(filename);

  // Remove a trailing media extension (only known ones, so "Bloons TD 6" stays intact)
  const nameWithoutExt = filename.replace(KNOWN_EXTENSIONS, '');

  // Drop bracketed release tags entirely: [AnimeRG], [1080p], [Dual Audio], ...
  // Parenthesised groups are kept; tag-like ones get cut by stop-word truncation below.
  let cleaned = nameWithoutExt.replace(/\[[^\]]*\]?/g, ' ');

  // Normalize separators to spaces (keep dashes for now: needed for anime " - 05" episodes,
  // and hyphenated titles like Spider-Man)
  cleaned = cleaned.replace(/[._+]/g, ' ').replace(/\s+/g, ' ').trim();

  // Strip leading site adverts: "www Torrenting com - ", "www UIndex org", ...
  cleaned = cleaned.replace(/^www\s+\S+\s+(?:com|org|net|info|io|cc|to|me|se|ws)\b[\s-]*/i, '');

  let type: 'movie' | 'tv' = 'movie';
  let season: number | undefined;
  let episode: number | undefined;
  let year: string | undefined;

  // Season & Episode patterns
  const sxxexxMatch = cleaned.match(/\b[sS](\d{1,2})\s*[eE](\d{1,3})\b/);
  const nxnMatch = cleaned.match(/\b(\d{1,2})[xX](\d{2})\b/);
  const seasonEpisodeMatch = cleaned.match(/\bseason\s*(\d{1,2})\s*episode\s*(\d{1,3})\b/i);
  // Anime style: "Show Name - 05", "Show Name - 05v2"
  const animeEpMatch = cleaned.match(/\s-\s(\d{1,3})(?:v\d)?(?=\s|$)/);
  // Season packs: "S01", "Season 1", "Seasons 1 2", "S01-S03", "Complete Series"
  const seasonRangeMatch = cleaned.match(/\b[sS](\d{1,2})\s*-\s*[sS]?(\d{1,2})\b/);
  const seasonOnlyMatch = cleaned.match(/\b[sS](\d{1,2})\b|\bseasons?\s*(\d{1,2})\b/i);
  const completeSeriesMatch = cleaned.match(/\bcomplete\s*(?:series|seasons?|batch|collection)?\b/i);

  if (sxxexxMatch) {
    type = 'tv';
    season = parseInt(sxxexxMatch[1], 10);
    episode = parseInt(sxxexxMatch[2], 10);
  } else if (nxnMatch) {
    type = 'tv';
    season = parseInt(nxnMatch[1], 10);
    episode = parseInt(nxnMatch[2], 10);
  } else if (seasonEpisodeMatch) {
    type = 'tv';
    season = parseInt(seasonEpisodeMatch[1], 10);
    episode = parseInt(seasonEpisodeMatch[2], 10);
  } else if (seasonRangeMatch) {
    type = 'tv';
    season = parseInt(seasonRangeMatch[1], 10);
  } else if (seasonOnlyMatch) {
    type = 'tv';
    season = parseInt(seasonOnlyMatch[1] || seasonOnlyMatch[2], 10);
  } else if (animeEpMatch && parseInt(animeEpMatch[1], 10) <= 300 && !/\b(19|20)\d{2}\b/.test(animeEpMatch[1])) {
    type = 'tv';
    season = 1;
    episode = parseInt(animeEpMatch[1], 10);
  } else if (completeSeriesMatch && /series|seasons/i.test(completeSeriesMatch[0])) {
    type = 'tv';
    season = 1;
  }

  // Year: prefer the first 19xx/20xx that is not the very start of the name
  // (so "2012.1080p.mkv" still titles as "2012")
  const yearMatches = [...cleaned.matchAll(/\b(19\d{2}|20\d{2})\b/g)];
  const yearMatch = yearMatches.find(m => (m.index ?? 0) > 0) || yearMatches[0];
  if (yearMatch && (yearMatch.index ?? 0) > 0) {
    year = yearMatch[1];
  }

  // Truncate the title at the first stop-word / marker occurrence
  let truncateIndex = cleaned.length;
  for (const word of STOP_WORDS) {
    const regex = new RegExp(`(?:^|[\\s(\\-])(${word})\\b`, 'i');
    const match = cleaned.match(regex);
    if (match && match.index !== undefined) {
      const idx = match.index + (match[0].length - match[1].length);
      if (idx > 0 && idx < truncateIndex) truncateIndex = idx;
    }
  }
  if (animeEpMatch && animeEpMatch.index !== undefined && type === 'tv' && episode !== undefined && !sxxexxMatch && !nxnMatch) {
    if (animeEpMatch.index < truncateIndex) truncateIndex = animeEpMatch.index;
  }

  let title = cleaned.slice(0, truncateIndex).trim();

  // Strip dangling separators / unbalanced brackets left behind by truncation
  title = title
    .replace(/[\s\-([{,.:;!&+]+$/g, '')
    .replace(/^[\s\-)\]},.:;!&+]+/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Fallback if truncation ate everything (e.g. "2012.1080p.mkv")
  if (!title) {
    title = cleaned.replace(/[\s\-([{,.:;!&+]+$/g, '').trim() || nameWithoutExt.trim();
  }

  return {
    title,
    year,
    season,
    episode,
    type,
    isMedia
  };
}
