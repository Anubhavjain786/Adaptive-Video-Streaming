import { Controller, Get, Post, Body, Param, Res } from "@nestjs/common";
import { Response } from "express";
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
   * GET /videos/hls/*
   * Proxies HLS content (m3u8 playlists + .ts segments) from private S3.
   * Rewrites relative URLs in m3u8 files to go through this proxy.
   */
  @Get("hls/*")
  async proxyHls(@Param("0") key: string, @Res() res: Response) {
    try {
      const { body, contentType } = await this.videosService.getHlsObject(key);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-cache");
      res.send(body);
    } catch (err: any) {
      const status = err?.name === "NoSuchKey" ? 404 : 500;
      res
        .status(status)
        .json({ error: err?.message || "Failed to fetch HLS content" });
    }
  }

  /**
   * GET /videos/:id
   * Returns the HLS master playlist proxy URL for the given videoId.
   */
  @Get(":id")
  async getPlaybackUrl(@Param("id") id: string) {
    return this.videosService.getPlaybackUrl(id);
  }
}
