import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { VideoPlayer } from '../components/VideoPlayer';
import { SourcePicker } from '../components/SourcePicker';
import type { ScrapeRequest, ScrapeSource } from '../components/SourcePicker';
import { apiUrl } from '../lib/api';
import { parseEpisodeFromFile, tmdbImage } from '../lib/utils';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Torrent } from '../types';

interface PlayerState {
  kind: 'torbox' | 'stream';
  torrentId?: number | string;
  fileId?: number | string;
  filename?: string;
  url?: string;
  label?: string;
  embed?: boolean;
}

/**
 * Watch page.
 *
 * Library flow:   /watch?torrentId=..&fileId=..&filename=..&title=..
 * Discovery flow: /watch/:type/:id[?season=&episode=] — scrapes all sources
 *                 via the SourcePicker, then plays the user's choice.
 */
export const WatchPage: React.FC = () => {
  const { type, id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();

  const isDiscovery = !!type && !!id;
  const torrentId = searchParams.get('torrentId');
  const fileId = searchParams.get('fileId');
  const filename = searchParams.get('filename') ?? '';
  const mediaTitleFromUrl = searchParams.get('title') ?? undefined;

  // Library flow
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(!!torrentId);

  // Discovery flow
  const [media, setMedia] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(isDiscovery);
  const [scraping, setScraping] = useState(false);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [torrentLoading, setTorrentLoading] = useState(false);

  // Magnet add feedback
  const [addingMagnet, setAddingMagnet] = useState(false);
  const [magnetAdded, setMagnetAdded] = useState(false);
  const [magnetError, setMagnetError] = useState('');

  const fetchTorrents = useCallback(async (): Promise<Torrent[]> => {
    if (!token) return [];
    try {
      const res = await fetch(apiUrl('/api/torrents'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      return data?.success ? (data.data ?? []) : [];
    } catch {
      return [];
    }
  }, [token]);

  // Library flow: hydrate torrent details for subtitles/videoFiles.
  useEffect(() => {
    if (!torrentId || !token) return;
    let cancelled = false;
    setLibraryLoading(true);
    (async () => {
      const list = await fetchTorrents();
      if (!cancelled) {
        setTorrent(list.find(t => String(t.id) === String(torrentId)) ?? null);
        setLibraryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [torrentId, token, fetchTorrents]);

  // Discovery flow: fetch TMDb details so the scrape request has title/year.
  useEffect(() => {
    if (!isDiscovery || !token) return;
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const endpoint = type === 'tv' ? 'tv' : 'movie';
        const res = await fetch(apiUrl(`/api/tmdb/${endpoint}/${id}`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled && json?.success) {
          setMedia(json.data);
          setScraping(true);
        }
      } catch {
        // Leave detailLoading false; page shows a friendly error
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDiscovery, type, id, token]);

  const buildRequest = (): ScrapeRequest => ({
    tmdbId: media.id,
    type: type === 'tv' ? 'tv' : 'movie',
    title: media.title || media.name || '',
    year: (media.release_date || media.first_air_date || '').slice(0, 4) || undefined,
    season: searchParams.get('season') ? parseInt(searchParams.get('season')!, 10) : type === 'tv' ? 1 : undefined,
    episode: searchParams.get('episode') ? parseInt(searchParams.get('episode')!, 10) : type === 'tv' ? 1 : undefined,
  });

  const handlePick = (source: ScrapeSource) => {
    if (source.magnet) {
      setMagnetError('');
      setAddingMagnet(true);
      fetch(apiUrl('/api/torbox/add'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ magnet: source.magnet }),
      })
        .then(r => r.json())
        .then(data => {
          setAddingMagnet(false);
          if (data.success) {
            setMagnetAdded(true);
            setTimeout(() => navigate('/library'), 1800);
          } else {
            setMagnetError(data.detail || 'Failed to add magnet to TorBox.');
          }
        })
        .catch(() => {
          setAddingMagnet(false);
          setMagnetError('Network error while adding magnet.');
        });
      return;
    }

    if (source.url) {
      const embed = source.embed ?? (!source.url.includes('.m3u8') && !/\.(m3u8|mp4|webm)(\?|$)/i.test(source.url));
      setPlayer({
        kind: 'stream',
        url: source.url,
        label: source.name || source.sourceId,
        embed,
      });
      return;
    }

    if (source.torrentId != null) {
      setPlayer({ kind: 'torbox', torrentId: source.torrentId, fileId: source.fileId });
      setTorrentLoading(true);
      (async () => {
        const list = await fetchTorrents();
        const found =
          list.find(t => String(t.id) === String(source.torrentId)) ??
          (media ? list.find(t => String(t.metadata.tmdbId) === String(media.id) && t.metadata.type === (type === 'tv' ? 'tv' : 'movie')) : undefined);
        setTorrent(found ?? null);
        if (!source.fileId && found?.videoFiles?.length) {
          const first = found.videoFiles[0];
          setPlayer(p => (p ? { ...p, fileId: first.id, filename: first.name } : p));
        }
        setTorrentLoading(false);
      })();
    }
  };

  const handleChangeSource = useCallback(() => {
    setPlayer(null);
    setScraping(true);
  }, []);

  const backToDetail = () => {
    if (type && id) navigate(`/${type === 'tv' ? 'tv' : 'movie'}/${id}`);
    else navigate('/');
  };

  const mediaTitle = mediaTitleFromUrl || media?.title || media?.name || torrent?.metadata?.title;

  // Magnet feedback overlay
  if (addingMagnet || magnetAdded) {
    return (
      <div className="watch-status">
        {magnetAdded ? (
          <CheckCircle2 size={44} color="var(--success)" />
        ) : (
          <Loader2 size={44} className="spinner" />
        )}
        <h3>{magnetAdded ? 'Added to TorBox' : 'Adding to TorBox...'}</h3>
        <p className="page-subtitle">
          {magnetAdded
            ? 'The torrent is being cached. Head to your library to stream it once ready.'
            : 'The magnet was found on an indexer and is being sent to your TorBox account.'}
        </p>
      </div>
    );
  }

  if (magnetError) {
    return (
      <div className="watch-status">
        <AlertCircle size={44} color="var(--error)" />
        <h3>Could not add magnet</h3>
        <p className="page-subtitle">{magnetError}</p>
        <button className="glass-button" onClick={backToDetail}>Back</button>
      </div>
    );
  }

  // Library flow loading
  if (libraryLoading || torrentLoading) {
    return (
      <div className="watch-status">
        <Loader2 size={44} className="spinner" />
        <p className="page-subtitle">Loading stream...</p>
      </div>
    );
  }

  // TorBox playback
  if (player?.kind === 'torbox') {
    const videoFile = torrent?.videoFiles.find(f => String(f.id) === String(player.fileId));
    return (
      <VideoPlayer
        torrentId={player.torrentId}
        fileId={player.fileId ?? videoFile?.id}
        filename={player.filename || videoFile?.name || filename}
        subtitles={videoFile?.subtitles ?? []}
        videoFiles={torrent?.videoFiles}
        mediaTitle={mediaTitle}
        torrentMetadata={torrent?.metadata}
        tmdbType={isDiscovery ? (type === 'tv' ? 'tv' : 'movie') : torrent?.metadata?.type === 'tv' ? 'tv' : torrent?.metadata?.type === 'movie' ? 'movie' : undefined}
        tmdbId={media?.id ?? torrent?.metadata?.tmdbId}
        tmdbSeason={searchParams.get('season') ? parseInt(searchParams.get('season')!, 10) : type === 'tv' ? 1 : undefined}
        tmdbEpisode={searchParams.get('episode') ? parseInt(searchParams.get('episode')!, 10) : type === 'tv' ? 1 : undefined}
        poster={media?.backdrop_path ? tmdbImage(media.backdrop_path, 'w1280') : torrent?.metadata?.backdropPath}
        onChangeSource={isDiscovery ? handleChangeSource : undefined}
        onClose={backToDetail}
        onPlayNext={(nextFileId, nextFilename, _nextSubtitles) => {
          const params = new URLSearchParams(searchParams);
          const nextTorrentId = player?.torrentId;
          if (nextTorrentId != null) params.set('torrentId', String(nextTorrentId));
          params.set('fileId', String(nextFileId));
          if (nextFilename) params.set('filename', nextFilename);
          navigate(`/watch?${params.toString()}`);
        }}
      />
    );
  }

  // External stream playback
  if (player?.kind === 'stream' && player.url) {
    return (
      <VideoPlayer
        externalUrl={player.url}
        externalKind={player.embed ? 'embed' : 'stream'}
        externalLabel={player.label}
        mediaTitle={mediaTitle}
        tmdbType={type === 'tv' ? 'tv' : 'movie'}
        tmdbId={media?.id}
        tmdbSeason={searchParams.get('season') ? parseInt(searchParams.get('season')!, 10) : type === 'tv' ? 1 : undefined}
        tmdbEpisode={searchParams.get('episode') ? parseInt(searchParams.get('episode')!, 10) : type === 'tv' ? 1 : undefined}
        onEpisodeSelect={(season, episode) => {
          if (type && id) navigate(`/watch/tv/${id}?season=${season}&episode=${episode}`);
        }}
        poster={media?.backdrop_path ? tmdbImage(media.backdrop_path, 'w1280') : undefined}
        onChangeSource={isDiscovery ? handleChangeSource : undefined}
        onClose={backToDetail}
      />
    );
  }

  // Library flow (no discovery params)
  if (torrentId) {
    const videoFile = torrent?.videoFiles.find(f => String(f.id) === String(fileId));
    return (
      <VideoPlayer
        torrentId={torrentId ?? undefined}
        fileId={fileId ?? undefined}
        filename={filename || videoFile?.name || ''}
        subtitles={videoFile?.subtitles ?? []}
        videoFiles={torrent?.videoFiles}
        mediaTitle={mediaTitleFromUrl || torrent?.metadata?.title}
        torrentMetadata={torrent?.metadata}
        tmdbType={torrent?.metadata?.type === 'tv' ? 'tv' : torrent?.metadata?.type === 'movie' ? 'movie' : undefined}
        tmdbId={torrent?.metadata?.tmdbId}
        tmdbSeason={parseEpisodeFromFile(filename || videoFile?.name || '')?.season}
        tmdbEpisode={parseEpisodeFromFile(filename || videoFile?.name || '')?.episode}
        poster={torrent?.metadata?.backdropPath}
        onClose={() => navigate('/library')}
        onPlayNext={(nextFileId, nextFilename, _nextSubtitles) => {
          const params = new URLSearchParams(searchParams);
          const nextTorrentId = player?.torrentId;
          if (nextTorrentId != null) params.set('torrentId', String(nextTorrentId));
          params.set('fileId', String(nextFileId));
          if (nextFilename) params.set('filename', nextFilename);
          navigate(`/watch?${params.toString()}`);
        }}
      />
    );
  }

  // Discovery flow: loading detail
  if (detailLoading) {
    return (
      <div className="watch-status">
        <Loader2 size={44} className="spinner" />
        <p className="page-subtitle">Preparing sources...</p>
      </div>
    );
  }

  // Discovery flow: scrape + pick
  if (isDiscovery && scraping && media) {
    return (
      <>
        <SourcePicker
          request={buildRequest()}
          onPick={handlePick}
          onCancel={backToDetail}
        />
      </>
    );
  }

  return (
    <div className="watch-status">
      <p className="page-subtitle">Nothing to play yet — choose a movie or show to get started.</p>
      <button className="glass-button" onClick={() => navigate('/')}>Browse titles</button>
    </div>
  );
};
