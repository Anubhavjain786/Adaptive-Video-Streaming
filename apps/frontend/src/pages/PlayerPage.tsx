import React, { useRef, useState } from 'react';
import Hls from 'hls.js';

const BACKEND = '/videos';

export default function PlayerPage() {
  const [videoId, setVideoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  async function handlePlay() {
    if (!videoId.trim() || !videoRef.current) return;
    setLoading(true);

    setErrorMessage(null);

    try {
      // Fetch playback URL from backend
      const res = await fetch(`${BACKEND}/${videoId}`);
      const { playbackUrl } = await res.json();
      const video = videoRef.current;

      if (!video) return;

      // Destroy previous HLS instance if any
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (Hls.isSupported()) {
        // Use hls.js for browsers that don't natively support HLS (Chrome, Firefox)
        const hls = new Hls({
          startLevel: -1, // -1 = automatic ABR quality selection
        });
        hlsRef.current = hls;
        hls.loadSource(playbackUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          console.log(`[hls.js] Quality level switched to ${data.level}`);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS on Safari / iOS
        video.src = playbackUrl;
        video.play();
      } else {
        setErrorMessage('HLS is not supported in this browser.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start playback.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page">
      <div className="page-hero">
        <div className="hero-card">
          <span className="eyebrow">Adaptive Playback</span>
          <h2>Route playback through the backend and let HLS choose the best stream.</h2>
          <p>
            The player fetches the master playlist through NestJS, rewrites segment paths through the HLS
            proxy, and uses hls.js where native playback is unavailable.
          </p>

          <div className="hero-metrics">
            <div className="hero-metric">
              <strong>hls.js</strong>
              <span>ABR on Chromium</span>
            </div>
            <div className="hero-metric">
              <strong>Safari</strong>
              <span>Native HLS fallback</span>
            </div>
            <div className="hero-metric">
              <strong>Private</strong>
              <span>S3 stays behind API</span>
            </div>
          </div>
        </div>

        <aside className="info-card">
          <h3>Available ladder</h3>
          <div className="playlist-list">
            <div className="playlist-item">
              <span>360p stream</span>
              <small>800k</small>
            </div>
            <div className="playlist-item">
              <span>480p stream</span>
              <small>1200k</small>
            </div>
            <div className="playlist-item">
              <span>720p stream</span>
              <small>2500k</small>
            </div>
          </div>
        </aside>
      </div>

      <div className="content-grid">
        <div className="player-stage">
          <h3>Playback console</h3>
          <div className="player-input-row">
            <input
              className="player-input"
              type="text"
              placeholder="Enter video ID, for example samplevideo"
              value={videoId}
              onChange={(e) => setVideoId(e.target.value)}
            />
            <button className="button-primary" onClick={handlePlay} disabled={!videoId.trim() || loading} type="button">
              {loading ? 'Loading…' : 'Play Stream'}
            </button>
          </div>

          {_stateMessage(loading, videoId)}

          {errorMessage ? (
            <div className="status-card error">
              <h4>Playback failed</h4>
              <p>{errorMessage}</p>
            </div>
          ) : null}

          {videoRef.current || hlsRef.current || videoId ? (
            <div className="video-frame" style={{ marginTop: '20px' }}>
              <video ref={videoRef} controls />
            </div>
          ) : null}
        </div>

        <aside className="panel">
          <h3>How playback works</h3>
          <div className="quality-grid">
            <div className="quality-chip">
              <span>Step 1</span>
              <small>GET /videos/:id</small>
            </div>
            <div className="quality-chip">
              <span>Step 2</span>
              <small>Load master.m3u8</small>
            </div>
            <div className="quality-chip">
              <span>Step 3</span>
              <small>Proxy playlists and segments</small>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function _stateMessage(loading: boolean, videoId: string) {
  if (loading) {
    return (
      <div className="status-card">
        <h4>Preparing stream</h4>
        <p>Fetching the playback URL and attaching the HLS source.</p>
      </div>
    );
  }

  if (!videoId.trim()) {
    return (
      <div className="player-empty">
        <div>
          <div className="player-empty-icon">▶</div>
          <h4>Enter a processed video ID to start playback.</h4>
          <p>
            The player will request the backend playlist URL first, then stream through the HLS proxy.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
