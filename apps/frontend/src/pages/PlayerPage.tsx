import React, { useRef, useState } from 'react';
import Hls from 'hls.js';

const BACKEND = '/videos';

export default function PlayerPage() {
  const [videoId, setVideoId] = useState('');
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  async function handlePlay() {
    if (!videoId.trim() || !videoRef.current) return;
    setLoading(true);

    // Fetch playback URL from backend
    const res = await fetch(`${BACKEND}/${videoId}`);
    const { playbackUrl } = await res.json();
    setLoading(false);

    const video = videoRef.current;

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
      alert('HLS is not supported in this browser.');
    }
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Play Video</h1>
      <input
        type="text"
        placeholder="Enter video ID (e.g. myvideo)"
        value={videoId}
        onChange={(e) => setVideoId(e.target.value)}
        style={{ width: '300px' }}
      />
      <button onClick={handlePlay} disabled={!videoId.trim() || loading} style={{ marginLeft: '1rem' }}>
        {loading ? 'Loading…' : 'Play'}
      </button>
      <br /><br />
      <video
        ref={videoRef}
        controls
        style={{ width: '100%', maxWidth: '900px', background: '#000' }}
      />
    </div>
  );
}
