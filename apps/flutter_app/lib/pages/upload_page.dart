import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../services/api_service.dart';

class UploadPage extends StatefulWidget {
  const UploadPage({super.key});

  @override
  State<UploadPage> createState() => _UploadPageState();
}

class _UploadPageState extends State<UploadPage> {
  PlatformFile? _selectedFile;
  _UploadState _state = _UploadState.idle;
  double _progress = 0;
  String? _videoId;
  String? _errorMessage;

  Future<void> _pickVideo() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.video,
      withData: false,
      withReadStream: false,
    );
    if (result == null || result.files.isEmpty) return;

    setState(() {
      _selectedFile = result.files.first;
      _state = _UploadState.idle;
      _videoId = null;
      _errorMessage = null;
      _progress = 0;
    });
  }

  Future<void> _upload() async {
    if (_selectedFile == null || _selectedFile!.path == null) return;

    setState(() {
      _state = _UploadState.uploading;
      _progress = 0;
      _errorMessage = null;
      _videoId = null;
    });

    try {
      // 1. Get presigned URL from backend
      final urls = await ApiService.instance.getUploadUrl(_selectedFile!.name);

      // 2. PUT file directly to S3
      await ApiService.instance.uploadFile(
        uploadUrl: urls['uploadUrl']!,
        filePath: _selectedFile!.path!,
        contentType: 'video/mp4',
        onProgress: (p) => setState(() => _progress = p),
      );

      setState(() {
        _state = _UploadState.done;
        _videoId = urls['videoId'];
      });
    } catch (e) {
      setState(() {
        _state = _UploadState.error;
        _errorMessage = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Upload Video'),
        centerTitle: true,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // File picker card
            GestureDetector(
              onTap: _state == _UploadState.uploading ? null : _pickVideo,
              child: Container(
                height: 160,
                decoration: BoxDecoration(
                  border: Border.all(
                    color: theme.colorScheme.outline,
                    width: 2,
                    style: BorderStyle.solid,
                  ),
                  borderRadius: BorderRadius.circular(16),
                  color: theme.colorScheme.surfaceContainerHighest
                      .withOpacity(0.3),
                ),
                child: Center(
                  child: _selectedFile == null
                      ? Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.video_library_rounded,
                                size: 48,
                                color: theme.colorScheme.primary),
                            const SizedBox(height: 12),
                            Text('Tap to select a video',
                                style: theme.textTheme.bodyLarge),
                          ],
                        )
                      : Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.video_file_rounded,
                                size: 48,
                                color: theme.colorScheme.primary),
                            const SizedBox(height: 12),
                            Text(
                              _selectedFile!.name,
                              style: theme.textTheme.bodyLarge,
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              _formatBytes(_selectedFile!.size),
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Upload button
            FilledButton.icon(
              onPressed: (_selectedFile == null ||
                      _state == _UploadState.uploading)
                  ? null
                  : _upload,
              icon: _state == _UploadState.uploading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload_rounded),
              label: Text(_state == _UploadState.uploading
                  ? 'Uploading…'
                  : 'Upload'),
            ),

            // Progress bar
            if (_state == _UploadState.uploading) ...[
              const SizedBox(height: 16),
              LinearProgressIndicator(value: _progress),
              const SizedBox(height: 6),
              Text(
                '${(_progress * 100).toStringAsFixed(1)}%',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ],

            // Success
            if (_state == _UploadState.done && _videoId != null) ...[
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.green.shade700),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.check_circle, color: Colors.green),
                        const SizedBox(width: 8),
                        Text('Upload successful!',
                            style: theme.textTheme.titleSmall
                                ?.copyWith(color: Colors.green)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text('Video ID:', style: theme.textTheme.labelSmall),
                    SelectableText(
                      _videoId!,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Lambda is now transcoding to all quality variants. '
                      'Go to the Play tab and enter this ID when ready.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],

            // Error
            if (_state == _UploadState.error && _errorMessage != null) ...[
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.red.shade700),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.error_outline, color: Colors.red),
                        const SizedBox(width: 8),
                        Text('Upload failed',
                            style: theme.textTheme.titleSmall
                                ?.copyWith(color: Colors.red)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(_errorMessage!,
                        style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

enum _UploadState { idle, uploading, done, error }
