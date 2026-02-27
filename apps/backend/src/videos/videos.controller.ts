import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { VideosService } from "./videos.service";

@Controller("videos")
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  /**
   * POST /videos/upload-url
   * Returns a presigned S3 PUT URL so the frontend can upload directly to S3.
   * Body: { filename: string }
   */
  @Post("upload-url")
  async getUploadUrl(@Body() body: { filename: string }) {
    return this.videosService.generateUploadUrl(body.filename);
  }

  /**
   * GET /videos/:id
   * Returns the HLS master playlist URL for the given videoId.
   * videoId = filename without extension (e.g. "myvideo" from "originals/myvideo.mp4")
   */
  @Get(":id")
  async getPlaybackUrl(@Param("id") id: string) {
    return this.videosService.getPlaybackUrl(id);
  }
}
