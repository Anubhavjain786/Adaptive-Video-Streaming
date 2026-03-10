import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:dio/dio.dart';

/// Change this to your machine's LAN IP when testing on a physical device.
/// Android emulator  → http://10.0.2.2:3000
/// iOS simulator     → http://localhost:3000
const String kBaseUrl = 'http://10.0.2.2:3000';

class ApiService {
  ApiService._();
  static final ApiService instance = ApiService._();

  final _dio = Dio();

  /// POST /videos/upload-url
  /// Returns { uploadUrl, key, videoId }
  Future<Map<String, String>> getUploadUrl(String filename) async {
    final uri = Uri.parse('$kBaseUrl/videos/upload-url');
    final res = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'filename': filename}),
    );

    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception('Failed to get upload URL: ${res.statusCode} ${res.body}');
    }

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return {
      'uploadUrl': data['uploadUrl'] as String,
      'key': data['key'] as String,
      'videoId': data['videoId'] as String,
    };
  }

  /// PUT presigned S3 URL — streams the file with progress callback
  Future<void> uploadFile({
    required String uploadUrl,
    required String filePath,
    required String contentType,
    void Function(double progress)? onProgress,
  }) async {
    await _dio.put(
      uploadUrl,
      data: await _openReadStream(filePath),
      options: Options(
        headers: {
          'Content-Type': contentType,
        },
        sendTimeout: const Duration(minutes: 30),
        receiveTimeout: const Duration(minutes: 5),
      ),
      onSendProgress: (sent, total) {
        if (total > 0) onProgress?.call(sent / total);
      },
    );
  }

  Future<dynamic> _openReadStream(String path) async {
    // Dio accepts a MultipartFile or a stream; use MultipartFile for simplicity
    return await MultipartFile.fromFile(path);
  }

  /// GET /videos/:id
  /// Returns the HLS proxy URL (m3u8 path served by the backend)
  Future<String> getPlaybackUrl(String videoId) async {
    final uri = Uri.parse('$kBaseUrl/videos/$videoId');
    final res = await http.get(uri);

    if (res.statusCode != 200) {
      throw Exception('Video not found: ${res.statusCode}');
    }

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final hlsPath = data['url'] as String; // e.g. /videos/hls/processed/xxx/master.m3u8

    // Make it a full URL the video_player can reach
    if (hlsPath.startsWith('http')) return hlsPath;
    return '$kBaseUrl$hlsPath';
  }
}
