import { parseMediaName } from './utils/parser';

const testCases = [
  {
    name: 'The.Batman.2022.1080p.WEBRip.x264.mp4',
    expected: { title: 'The Batman', year: '2022', type: 'movie', season: undefined, episode: undefined }
  },
  {
    name: 'Stranger.Things.S04E01.720p.mkv',
    expected: { title: 'Stranger Things', year: undefined, season: 4, episode: 1, type: 'tv' }
  },
  {
    name: 'Breaking.Bad.S05.1080p.BluRay.x264.mkv',
    expected: { title: 'Breaking Bad', year: undefined, season: 5, episode: undefined, type: 'tv' }
  },
  {
    name: 'The.Office.US.S09E23.1080p.mkv',
    expected: { title: 'The Office US', year: undefined, season: 9, episode: 23, type: 'tv' }
  },
  {
    name: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265.mkv',
    expected: { title: 'Dune Part Two', year: '2024', type: 'movie', season: undefined, episode: undefined }
  },
  {
    name: 'Seinfeld.9x10.The.Dealership.mp4',
    expected: { title: 'Seinfeld', year: undefined, season: 9, episode: 10, type: 'tv' }
  },
  {
    name: 'Soul.Plane.(2004).1080p.BluRay.x264.mkv',
    expected: { title: 'Soul Plane', year: '2004', type: 'movie', season: undefined, episode: undefined }
  },
  {
    name: 'www.Torrenting.com - Piece by Piece 2024 1080p WEB-DL',
    expected: { title: 'Piece by Piece', year: '2024', type: 'movie', season: undefined, episode: undefined }
  },
  {
    name: '[SubsPlease] Sousou no Frieren - 05 (1080p) [A1B2C3D4].mkv',
    expected: { title: 'Sousou no Frieren', year: undefined, season: 1, episode: 5, type: 'tv' }
  },
  {
    name: '[Judas] Code Geass Hangyaku no Lelouch (Seasons 1 2 Movies OVAs) [BD 1080p][HEVC x265 10bit]',
    expected: { title: 'Code Geass Hangyaku no Lelouch', year: undefined, season: 1, episode: undefined, type: 'tv' }
  },
  {
    name: '[YURI] SHIMONETA A Boring World Where the Concept of Dirty Jokes Doesn’t Exist (Dual Audio) [BD 1080p]',
    expected: { title: 'SHIMONETA A Boring World Where the Concept of Dirty Jokes Doesn’t Exist', year: undefined, season: undefined, episode: undefined, type: 'movie' }
  },
  {
    name: 'Euphoria.US.S03E08.1080p.WEB.h264-ETHEL',
    expected: { title: 'Euphoria US', year: undefined, season: 3, episode: 8, type: 'tv' }
  },
  {
    name: '2012.1080p.BluRay.mkv',
    expected: { title: '2012', year: undefined, type: 'movie', season: undefined, episode: undefined }
  }
];

// Non-media detection checks
const nonMediaCases: Array<{ name: string; isMedia: boolean }> = [
  { name: 'Need for Speed Most Wanted [FitGirl Repack]', isMedia: false },
  { name: 'Cuphead GOG', isMedia: false },
  { name: 'MediaMonkey Gold v4.1.23.1881 Final Portable', isMedia: false },
  { name: 'Ableton Live Suite 12', isMedia: false },
  { name: 'The.Batman.2022.1080p.WEBRip.x264.mp4', isMedia: true },
  { name: 'Patch Adams 1998 720p BluRay', isMedia: true }
];

let failed = 0;
for (const tc of testCases) {
  const result = parseMediaName(tc.name);
  console.log(`Input: "${tc.name}"`);
  console.log(`Parsed:`, result);
  
  const titleOk = result.title === tc.expected.title;
  const yearOk = result.year === tc.expected.year;
  const typeOk = result.type === tc.expected.type;
  const seasonOk = result.season === tc.expected.season;
  const episodeOk = result.episode === tc.expected.episode;
  
  if (titleOk && yearOk && typeOk && seasonOk && episodeOk) {
    console.log('✅ PASS\n');
  } else {
    console.log('❌ FAIL');
    console.log('Expected:', tc.expected);
    console.log('');
    failed++;
  }
}

for (const tc of nonMediaCases) {
  const result = parseMediaName(tc.name);
  if (result.isMedia === tc.isMedia) {
    console.log(`✅ PASS isMedia=${tc.isMedia}: "${tc.name}"`);
  } else {
    console.log(`❌ FAIL isMedia: "${tc.name}" expected ${tc.isMedia}, got ${result.isMedia}`);
    failed++;
  }
}
console.log('');

if (failed === 0) {
  console.log('=== SUCCESS: All parser tests passed! ===');
  process.exit(0);
} else {
  console.log(`=== FAILURE: ${failed} tests failed! ===`);
  process.exit(1);
}
