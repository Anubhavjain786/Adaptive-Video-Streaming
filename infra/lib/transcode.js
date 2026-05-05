"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const ALLOWED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".m4v",
  ".mpeg",
  ".mpg",
  ".3gp",
]);

const RENDITIONS = [
  { name: "360p", scale: "640:360", bitrate: "800k" },
  { name: "480p", scale: "854:480", bitrate: "1200k" },
  { name: "720p", scale: "1280:720", bitrate: "2500k" },
  { name: "1080p", scale: "1920:1080", bitrate: "5000k" },
  { name: "2k", scale: "2560:1440", bitrate: "10000k" },
  { name: "4k", scale: "3840:2160", bitrate: "20000k" },
];

const MAX_PARALLEL = 4;
const FFmpegInactivityTimeoutMs = parseInt(
  process.env.FFMPEG_INACTIVITY_TIMEOUT_MS || "900000",
  10,
);

async function transcodeObject({
  bucket,
  key,
  s3,
  ffmpegPath,
  outputDir = "/tmp/output",
}) {
  if (!key.startsWith("originals/")) {
    console.log("Skipping non-originals key:", key);
    return { skipped: true, reason: "non-originals" };
  }

  const fileExt = path.extname(key).toLowerCase();
  if (!ALLOWED_VIDEO_EXTENSIONS.has(fileExt)) {
    console.warn(
      `Skipping "${key}" — unsupported extension "${fileExt}". Only video files are processed.`,
    );
    return { skipped: true, reason: "unsupported-extension" };
  }

  const relativeKey = key.slice("originals/".length);
  const assetPath = relativeKey.slice(0, -fileExt.length);
  if (!assetPath) {
    console.warn(`Unable to derive assetPath from key="${key}"`);
    return { skipped: true, reason: "invalid-asset-path" };
  }

  console.log(`Processing assetPath="${assetPath}" from key="${key}"`);

  const headResp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  headResp.Body.destroy();

  const contentType = (headResp.ContentType || "").toLowerCase();
  if (
    contentType &&
    !contentType.startsWith("video/") &&
    contentType !== "application/octet-stream"
  ) {
    console.warn(
      `Skipping "${key}" — ContentType is "${contentType}", not a video. Aborting.`,
    );
    return { skipped: true, reason: "invalid-content-type" };
  }

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 },
  );

  resetOutputDir(outputDir);

  for (const rendition of RENDITIONS) {
    fs.mkdirSync(`${outputDir}/${rendition.name}`);
  }

  console.log(`Transcoding all renditions in batches of ${MAX_PARALLEL}...`);
  for (let index = 0; index < RENDITIONS.length; index += MAX_PARALLEL) {
    const batch = RENDITIONS.slice(index, index + MAX_PARALLEL);
    await Promise.all(
      batch.map((rendition) =>
        transcodeRendition({ ffmpegPath, presignedUrl, outputDir, rendition }),
      ),
    );
  }

  writeMasterPlaylist(outputDir);
  await uploadOutputs({ bucket, assetPath, outputDir, s3 });

  console.log(
    `Done — asset "${assetPath}" is ready at processed/${assetPath}/master.m3u8`,
  );

  return { skipped: false, assetPath };
}

function resetOutputDir(outputDir) {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });
}

function transcodeRendition({
  ffmpegPath,
  presignedUrl,
  outputDir,
  rendition,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const outPath = `${outputDir}/${rendition.name}`;
    const args = [
      "-y",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      "-i",
      presignedUrl,
      "-vf",
      `scale=${rendition.scale}`,
      "-c:v",
      "h264",
      "-preset",
      "ultrafast",
      "-b:v",
      rendition.bitrate,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      `${outPath}/seg_%03d.ts`,
      `${outPath}/playlist.m3u8`,
    ];

    const ffmpeg = spawn(ffmpegPath, args);
    let stderrOutput = "";
    let inactivityTimeout = armInactivityTimeout();

    function armInactivityTimeout() {
      return setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        ffmpeg.kill("SIGTERM");
        setTimeout(() => ffmpeg.kill("SIGKILL"), 10_000).unref();
        reject(new Error(`FFmpeg stalled: ${rendition.name}`));
      }, FFmpegInactivityTimeoutMs);
    }

    function refreshInactivityTimeout() {
      clearTimeout(inactivityTimeout);
      inactivityTimeout = armInactivityTimeout();
    }

    ffmpeg.stderr.on("data", (data) => {
      stderrOutput += data.toString();
      refreshInactivityTimeout();
      console.log(`[${rendition.name}] stderr: ${data.toString()}`);
    });

    ffmpeg.stdout.on("data", () => {
      // FFmpeg progress is emitted to stderr; stdout is intentionally ignored.
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(inactivityTimeout);
      if (settled) {
        return;
      }

      settled = true;
      if (code === 0) {
        resolve();
        return;
      }

      const errorMessage = `Exit ${code}: ${rendition.name} - ${stderrOutput.slice(-500)}`;
      console.error(`[${rendition.name}] Error: ${errorMessage}`);
      reject(new Error(errorMessage));
    });

    ffmpeg.on("error", (error) => {
      clearTimeout(inactivityTimeout);
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });
  });
}

function writeMasterPlaylist(outputDir) {
  let master = "#EXTM3U\n";
  for (const rendition of RENDITIONS) {
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(rendition.bitrate, 10) * 1000},RESOLUTION=${rendition.scale.replace(":", "x")}\n${rendition.name}/playlist.m3u8\n`;
  }
  fs.writeFileSync(`${outputDir}/master.m3u8`, master);
}

async function uploadOutputs({ bucket, assetPath, outputDir, s3 }) {
  const files = fs.readdirSync(outputDir, { recursive: true });
  const uploadTasks = files
    .filter((file) => !fs.statSync(path.join(outputDir, file)).isDirectory())
    .map((file) => {
      const fullPath = path.join(outputDir, file);
      const s3Key = `processed/${assetPath}/${file}`;
      const contentType = file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/MP2T";

      return s3
        .send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: fs.readFileSync(fullPath),
            ContentType: contentType,
          }),
        )
        .then(() => console.log(`Uploaded: ${s3Key}`));
    });

  await Promise.all(uploadTasks);
}

module.exports = {
  transcodeObject,
};
