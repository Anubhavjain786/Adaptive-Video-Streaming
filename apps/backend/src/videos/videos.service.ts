import { Injectable } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION || "ap-south-1";
const BUCKET = process.env.AWS_BUCKET_NAME!;

@Injectable()
export class VideosService {
  private s3 = new S3Client({
    region: REGION,
    // Disable automatic CRC32 checksum injection — it embeds a placeholder
    // checksum into presigned URLs that breaks uploads from non-SDK clients.
    requestChecksumCalculation: "WHEN_REQUIRED" as any,
    responseChecksumValidation: "WHEN_REQUIRED" as any,
  });

  /**
   * Generate a presigned PUT URL for uploading a raw video to originals/.
   * videoId is derived from the filename (without extension) — matches the
   * Lambda handler's videoId derivation: path.basename(key).split(".")[0]
   */
  async generateUploadUrl(filename: string) {
    // Strip any directory components; keep only the base filename
    const base = filename.split("/").pop() ?? filename;
    const key = `originals/${base}`;
    const videoId = base.split(".")[0];

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "video/mp4",
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });

    return { uploadUrl, key, videoId };
  }

  /**
   * Return the backend proxy path for the HLS master playlist.
   * All HLS content (m3u8 + segments) is proxied through the backend
   * so the private S3 bucket is never accessed directly by the browser.
   */
  getPlaybackUrl(videoId: string) {
    const playbackUrl = `/videos/hls/processed/${videoId}/master.m3u8`;
    return { videoId, playbackUrl };
  }

  /**
   * Proxy an HLS object (m3u8 playlist or .ts segment) from private S3.
   * For m3u8 files, rewrites relative paths so they also go through this proxy.
   */
  async getHlsObject(
    key: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const resp = await this.s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );

    const chunks: Buffer[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    let body = Buffer.concat(chunks);
    let contentType = resp.ContentType || "application/octet-stream";

    // Rewrite relative URLs in m3u8 playlists so hls.js fetches segments
    // through the backend proxy instead of directly to private S3.
    if (key.endsWith(".m3u8")) {
      const dir = key.substring(0, key.lastIndexOf("/"));
      const text = body
        .toString("utf8")
        .replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
          // Skip absolute URLs
          if (line.startsWith("http")) return line;
          const resolvedKey = `${dir}/${line}`;
          return `/videos/hls/${resolvedKey}`;
        });
      body = Buffer.from(text, "utf8");
      contentType = "application/vnd.apple.mpegurl";
    }

    return { body, contentType };
  }
}
