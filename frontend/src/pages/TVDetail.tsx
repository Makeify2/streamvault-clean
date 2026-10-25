import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Star, Loader2, Film } from 'lucide-react';
import { useTVDetail, useTVSeason, useCredits } from '../hooks/useTmdb';
import { tmdbImage } from '../lib/utils';

/**
 * TV show detail — backdrop, poster, meta, cast, season/episode picker, Watch Now.
 */
export const TVDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: show, loading } = useTVDetail(id);
  const { data: credits } = useCredits('tv', id);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const { data: seasonData, loading: seasonLoading } = useTVSeason(id, selectedSeason);

  useEffect(() => {
    if (selectedSeason === null && show?.seasons?.length) {
      const first = show.seasons.find((s: any) => s.season_number > 0);
      if (first) setSelectedSeason(first.season_number);
    }
  }, [show, selectedSeason]);

  if (loading) {
    return (
      <div className="page-loading">
        <Loader2 size={40} className="spinner" />
        <p>Loading show...</p>
      </div>
    );
  }

  if (!show) {
    return (
      <div className="page-container" style={{ paddingTop: 48 }}>
        <h1 className="page-title">Show not found</h1>
        <p className="page-subtitle">This title isn't available in TMDb.</p>
      </div>
    );
  }

  const cast = (credits?.cast ?? []).slice(0, 10);
  const genres: { id: number; name: string }[] = show.genres ?? [];
  const seasons: { season_number: number; name: string; episode_count: number }[] =
    (show.seasons ?? []).filter((s: any) => s.season_number > 0);
  const episodes: any[] = seasonData?.episodes ?? [];
  const backdrop = tmdbImage(show.backdrop_path || show.poster_path, 'w1280');

  return (
    <div className="detail-page">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${backdrop})` }} />}

      <div className="detail-body page-container">
        <div className="detail-hero">
          <div className="detail-poster-wrap">
            {show.poster_path ? (
              <img src={tmdbImage(show.poster_path, 'w500')} alt={show.name} />
            ) : (
              <Film size={64} color="var(--text-muted)" />
            )}
          </div>

          <div className="detail-info">
            <h1 className="page-title">{show.name}</h1>
            <div className="detail-meta">
              {show.first_air_date && <span>{show.first_air_date.slice(0, 4)}</span>}
              {show.number_of_seasons ? <span>{show.number_of_seasons} seasons</span> : null}
              {show.vote_average > 0 && (
                <span className="detail-rating">
                  <Star size={14} fill="currentColor" /> {show.vote_average.toFixed(1)}
                </span>
              )}
            </div>
            {genres.length > 0 && (
              <div className="genre-pills">
                {genres.map(g => <span key={g.id} className="genre-pill">{g.name}</span>)}
              </div>
            )}
            {show.overview && <p className="detail-overview">{show.overview}</p>}
            <div className="hero-actions">
              <button className="glass-button glass-button-primary" onClick={() => navigate(`/watch/tv/${show.id}?season=${selectedSeason ?? 1}&episode=1`)}>
                <Play size={16} fill="currentColor" /> Watch Now
              </button>
            </div>
          </div>
        </div>

        {cast.length > 0 && (
          <section>
            <h2 className="section-title">Cast</h2>
            <div className="cast-row">
              {cast.map((person: any) => (
                <div key={person.id} className="cast-card">
                  {person.profile_path ? (
                    <img src={tmdbImage(person.profile_path, 'w185')} alt={person.name} loading="lazy" />
                  ) : (
                    <div className="cast-fallback"><Film size={26} color="var(--text-muted)" /></div>
                  )}
                  <p className="cast-name">{person.name}</p>
                  <p className="cast-role">{person.character}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="section-title">Episodes</h2>
          {seasons.length > 0 && (
            <div className="season-select">
              <label htmlFor="season-select" className="page-subtitle">Season</label>
              <select
                id="season-select"
                value={selectedSeason ?? ''}
                onChange={e => setSelectedSeason(parseInt(e.target.value, 10))}
              >
                {seasons.map(s => (
                  <option key={s.season_number} value={s.season_number}>
                    {s.name} ({s.episode_count} episodes)
                  </option>
                ))}
              </select>
            </div>
          )}

          {seasonLoading ? (
            <div className="row-stub glass-panel">
              <Loader2 size={28} className="spinner" />
            </div>
          ) : episodes.length > 0 ? (
            <div className="episode-list">
              {episodes.map(ep => (
                <button
                  key={ep.id}
                  className="episode-card"
                  onClick={() => navigate(`/watch/tv/${show.id}?season=${selectedSeason}&episode=${ep.episode_number}`)}
                >
                  {ep.still_path ? (
                    <img className="episode-thumb" src={tmdbImage(ep.still_path, 'w300')} alt={ep.name} loading="lazy" />
                  ) : (
                    <div className="episode-thumb episode-thumb-fallback" />
                  )}
                  <div className="episode-info">
                    <p className="episode-title">
                      <span className="episode-num">E{ep.episode_number}</span> {ep.name}
                    </p>
                    {ep.overview && <p className="episode-overview">{ep.overview}</p>}
                    {ep.air_date && <p className="episode-air">{ep.air_date}</p>}
                  </div>
                  <Play size={18} className="episode-play" />
                </button>
              ))}
            </div>
          ) : (
            <p className="page-subtitle">No episodes listed for this season.</p>
          )}
        </section>
      </div>
    </div>
  );
};
