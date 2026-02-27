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
    <div style={{ padding: '2rem' }}>
      <h1>Upload Video</h1>
      <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={handleUpload} disabled={!file} style={{ marginLeft: '1rem' }}>
        Upload
      </button>
      {progress > 0 && <p>Progress: {progress}%</p>}
      {status && <p>{status}</p>}
      {videoId && (
        <p>
          <strong>Video ID:</strong> <code>{videoId}</code> — use this on the Player page.
        </p>
      )}
    </div>
  );
}
