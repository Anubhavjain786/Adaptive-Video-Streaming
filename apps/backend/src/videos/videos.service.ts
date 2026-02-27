import { Injectable } from "@nestjs/common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = "ap-south-1";
const STAGE = process.env.STAGE || "dev";
const BUCKET = `video-streaming-poc-${STAGE}`;
const IS_LOCAL = STAGE === "local";
// LocalStack S3 endpoint (used when STAGE=local)
const LOCALSTACK_ENDPOINT = "http://localhost:4566";

@Injectable()
export class VideosService {
  private s3 = new S3Client({
    region: REGION,
    // Disable automatic CRC32 checksum injection — it embeds a placeholder
    // checksum into presigned URLs that breaks uploads from non-SDK clients.
    requestChecksumCalculation: "WHEN_REQUIRED" as any,
    responseChecksumValidation: "WHEN_REQUIRED" as any,
    ...(IS_LOCAL && {
      // Point SDK at LocalStack instead of real AWS
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true, // LocalStack requires path-style: localhost:4566/<bucket>/key
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    }),
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
   * Return the S3 URL for the HLS master playlist of a transcoded video.
   * Lambda outputs to processed/<videoId>/master.m3u8 after transcoding.
   */
  getPlaybackUrl(videoId: string) {
    // LocalStack uses path-style URLs; AWS uses virtual-hosted style
    const playbackUrl = IS_LOCAL
      ? `${LOCALSTACK_ENDPOINT}/${BUCKET}/processed/${videoId}/master.m3u8`
      : `https://${BUCKET}.s3.${REGION}.amazonaws.com/processed/${videoId}/master.m3u8`;
    return { videoId, playbackUrl };
  }
}
