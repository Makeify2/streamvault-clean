// Auto-detect media badges (resolution, quality, HDR, audio, etc.) from
// torrent filenames. Based on the ColorfulAndConcise badge.json definitions.

export interface BadgeMeta {
  id: string;
  name: string;
  color: string;
}

interface BadgeDef {
  id: string;
  name: string;
  color: string;
  pattern: RegExp;
}

const BADGE_DEFS: BadgeDef[] = [
  // ── Resolution ──
  { id: 'r-4k',   name: '4K',      color: '#F5C400', pattern: /(?:^|[\s\[(_.,\-])(?:4k|2160[pi]?|uhd|3840x2160)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'r-1080', name: '1080p',   color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:1080[pi]?|fhd|1920x1080)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'r-720',  name: '720p',    color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:720[pi]?|hd|1280x720)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gr-1440p', name: '2K QHD', color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:1440[pi]?)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gr-480p',  name: 'SD',    color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:480[pi]?)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gr-576p',  name: 'SD PAL', color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:576[pi]?)(?:[\s)\]_.,0-9+\-]|$)/i },

  // ── Quality / Source ──
  { id: 'q-r',      name: 'Remux',  color: '#F5C400', pattern: /(?:^|[\s\[(_.,\-])(?:remux|bdremux|uhdremux)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'q-b',      name: 'BluRay', color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:bluray|blu-ray|bdrip|brrip)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'q-w',      name: 'WEB-DL', color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:web[\-_. ]?dl)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'src-webrip', name: 'WEBRip', color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:web[\-_. ]?rip)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'src-hdtv', name: 'HDTV',   color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:hdtv)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'src-hdrip', name: 'HDRip', color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:hd[\-_. ]?rip)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gq-hc-hdrip', name: 'HC HDRip', color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:hc[\-_. ]?hd[\-_. ]?rip)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gq-cam',    name: 'CAM',   color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:cam(?:rip)?)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gq-ts',     name: 'TS',    color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:ts)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gq-tc',     name: 'TC',    color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:tc)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gq-scr',    name: 'SCR',   color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:scr(?:een(?:er)?)?)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'src-dvdrip', name: 'DVDRip', color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:dvd[\-_. ]?(?:rip|mux|r|full|5|9)?)(?:[\s)\]_.,0-9+\-]|$)/i },

  // ── Visual (HDR, etc.) ──
  { id: 'a-dv',      name: 'DV',      color: '#F5C400', pattern: /(?:^|[\s\[(_.,\-])(?:dv|dovi|dolby[.\- _]?vision)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-atmosvision', name: 'AtmosVision', color: '#F5C400', pattern: /atmos[\s_.\-]?vision/i },
  { id: 'v-hdr10p',  name: 'HDR10+',  color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:hdr10(?:\+|plus|p|%2b))(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'v-hdr10',   name: 'HDR10',   color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:hdr10)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'v-hdr',     name: 'HDR',     color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:hdr)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-10bit',  name: '10bit',   color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:10[\-_. ]?bit|hi10p)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'v-sdr',     name: 'SDR',     color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:sdr)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-hlg',    name: 'HLG',     color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:hlg)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'v-imax-e-2', name: 'IMAX Enhanced', color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:imax[\s._\-]?enhanced)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'v-imax-2',  name: 'IMAX',    color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:imax)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-ai',     name: 'AI',      color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:ai)(?:[\s)\]_.,0-9+\-]|$)/i },

  // ── Audio ──
  { id: 'a-at',     name: 'Atmos',    color: '#F5C400', pattern: /(?:^|[\s\[(_.,\-])(?:atmos|ddpa[0-9]?)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-dtsx',   name: 'DTS:X',    color: '#F5C400', pattern: /(?:^|[\s\[(_.,\-])(?:dts[\-_.: ]?x)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-th',     name: 'TrueHD',   color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:true[\s._\-]?hd)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-dtsma',  name: 'DTS-HD MA', color: '#1976D2', pattern: /(?:^|[\s\[(_.,\-])(?:dts[\-_. ]?(?:hd[\-_. ]?)?ma)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-dtshd',  name: 'DTS-HD',   color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:dts[\-_. ]?hd)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-dp',     name: 'DD+',      color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:dd\+|ddp|eac3|e-ac-3)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-dts-es', name: 'DTS-ES',  color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:dts[\-_. ]?es)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-flac',  name: 'FLAC',     color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:flac)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-opus',  name: 'OPUS',     color: '#43A047', pattern: /(?:^|[\s\[(_.,\-])(?:opus)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-dts',    name: 'DTS',      color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:dts)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'a-dd',     name: 'DD',       color: '#E53935', pattern: /(?:^|[\s\[(_.,\-])(?:dd[25][. ][01]|ac-?3)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gv-aac',   name: 'AAC',      color: '#FB8C00', pattern: /(?:^|[\s\[(_.,\-])(?:aac)(?:[\s)\]_.,0-9+\-]|$)/i },

  // ── Channels ──
  { id: 'ch-71', name: '7.1', color: '#000000', pattern: /(?:^|[\s\[(_.,\-])(?:7[ .][01]ch?|8ch)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'ch-51', name: '5.1', color: '#000000', pattern: /(?:^|[\s\[(_.,\-])(?:5[ .][01]ch?|6ch)(?:[\s)\]_.,0-9+\-]|$)/i },

  // ── Encoder ──
  { id: 'ge-av1',  name: 'AV1',      color: '#000000', pattern: /(?:^|[\s\[(_.,\-])(?:av1)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-h265',  name: 'H.265',    color: '#000000', pattern: /(?:^|[\s\[(_.,\-])(?:x265|h[.\-_]?265|hevc)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-h264',  name: 'H.264',    color: '#000000', pattern: /(?:^|[\s\[(_.,\-])(?:x264|h[.\-_]?264|avc)(?:[\s)\]_.,0-9+\-]|$)/i },

  // ── Streaming Service ──
  { id: 's-nflx',   name: 'Netflix',      color: '#E50914', pattern: /(?:^|[\s\[(_.,\-])(?:nflx|netflix)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-amzn',   name: 'Prime Video',  color: '#00A8E1', pattern: /(?:^|[\s\[(_.,\-])(?:amzn|amazon|prime[.\- _]?video|primevideo|prime|pv)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-atvp',   name: 'Apple TV+',    color: '#A2AAAD', pattern: /(?:^|[\s\[(_.,\-])(?:atvp|apple[.\- _]?tv\+?|appletv|itunes|itms)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-dsnp',   name: 'Disney+',      color: '#0063E5', pattern: /(?:^|[\s\[(_.,\-])(?:dsnp|dsny|disney\+?|disney[.\- _]?plus|disneyplus|d\+|dplus)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-hmax',   name: 'HBO Max',      color: '#A45CFF', pattern: /(?:^|[\s\[(_.,\-])(?:hmax|hbomax|hbo[.\- _]?max)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-hulu',   name: 'Hulu',         color: '#1CE783', pattern: /(?:^|[\s\[(_.,\-])(?:hulu)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-pamp',   name: 'Paramount+',   color: '#0064FF', pattern: /(?:^|[\s\[(_.,\-])(?:pmtp|pamp|paramount\+?|paramount[.\- _]?plus|paramountplus|p\+)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 's-croll',  name: 'Crunchyroll',  color: '#F47521', pattern: /(?:^|[\s\[(_.,\-])(?:crunchyroll)(?:[\s)\]_.,0-9+\-]|$)/i },
  { id: 'gs-peacock', name: 'Peacock',    color: '#FCCC12', pattern: /(?:^|[\s\[(_.,\-])(?:pcok|peacock)(?:[\s)\]_.,0-9+\-]|$)/i },
];

/**
 * Test all badge patterns against a filename string (torrent name or video file
 * name) and return matching badges. Order of returned badges follows the
 * priority groups: resolution > quality > visual > audio > channels > encoder >
 * streaming.
 */
export function detectBadges(filename: string): BadgeMeta[] {
  const seen = new Set<string>();
  const result: BadgeMeta[] = [];

  for (const def of BADGE_DEFS) {
    if (seen.has(def.name)) continue;
    if (def.pattern.test(filename)) {
      seen.add(def.name);
      result.push({ id: def.id, name: def.name, color: def.color });
    }
  }

  return result;
}
