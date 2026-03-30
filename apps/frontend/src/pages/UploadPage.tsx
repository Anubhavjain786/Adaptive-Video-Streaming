import React, { useState } from 'react';

const BACKEND = '/videos';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>('');

  async function handleUpload() {
    if (!file) return;
    setStatus('Requesting upload URL…');

    // 1. Get presigned PUT URL from the backend
    const res = await fetch(`${BACKEND}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name }),
    });
    const { uploadUrl, videoId: id } = await res.json();

    // 2. PUT the file directly to S3 using the presigned URL
    setStatus('Uploading to S3…');
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', 'video/mp4');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });

    setVideoId(id);
    setStatus('Upload complete! Lambda is transcoding in the background.');
  }

  return (
    <section className="page">
      <div className="page-hero">
        <div className="hero-card">
          <span className="eyebrow">Direct To S3 Upload</span>
          <h2>Push source video to the pipeline in one step.</h2>
          <p>
            The browser requests a presigned URL from NestJS, uploads the source file directly to S3,
            and lets Lambda handle the FFmpeg transcoding in the background.
          </p>

          <div className="hero-metrics">
            <div className="hero-metric">
              <strong>3</strong>
              <span>Adaptive renditions</span>
            </div>
            <div className="hero-metric">
              <strong>4s</strong>
              <span>HLS segment target</span>
            </div>
            <div className="hero-metric">
              <strong>S3</strong>
              <span>Direct upload path</span>
            </div>
          </div>
        </div>

        <aside className="info-card">
          <h3>Pipeline stages</h3>
          <div className="stack-list">
            <div className="stack-item">
              <span>Request upload URL</span>
              <small>NestJS</small>
            </div>
            <div className="stack-item">
              <span>Upload source</span>
              <small>S3 originals/</small>
            </div>
            <div className="stack-item">
              <span>Transcode and package</span>
              <small>Lambda + FFmpeg</small>
            </div>
            <div className="stack-item">
              <span>Serve playback</span>
              <small>HLS proxy</small>
            </div>
          </div>
        </aside>
      </div>

      <div className="content-grid">
        <div className="panel">
          <h3>Upload source video</h3>
          <label className="dropzone">
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            <div>
              <div className="dropzone-icon">↑</div>
              <h4>{file ? file.name : 'Drop a video file or click to browse'}</h4>
              <p>
                {file
                  ? 'Ready to upload this asset to S3 using a presigned PUT request.'
                  : 'Optimized for quick POC uploads and direct object-triggered transcoding.'}
              </p>

              <div className="button-row">
                <button className="button-primary" onClick={handleUpload} disabled={!file} type="button">
                  {file ? 'Upload To S3' : 'Select A Video'}
                </button>
                <button className="button-secondary" type="button" disabled>
                  MP4 Recommended
                </button>
              </div>
            </div>
          </label>

          {progress > 0 && (
            <div className="progress-block">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="muted">Upload progress: {progress}%</p>
            </div>
          )}

          {status && <p className="muted">{status}</p>}

          {videoId && (
            <div className="status-card success">
              <h4>Upload complete</h4>
              <p>
                Video ID: <span className="inline-code">{videoId}</span>
              </p>
              <p>Lambda is transcoding in the background. Use this ID on the playback page.</p>
            </div>
          )}
        </div>

        <aside className="panel">
          <h3>Notes</h3>
          <ul className="tips-list">
            <li>The API returns a presigned URL instead of proxying file bytes.</li>
            <li>Video IDs are derived from the uploaded filename without the extension.</li>
            <li>Processed HLS output is written to <span className="inline-code">processed/&lt;videoId&gt;/</span>.</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
