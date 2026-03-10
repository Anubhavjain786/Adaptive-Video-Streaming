import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:chewie/chewie.dart';
import '../services/api_service.dart';

class PlayerPage extends StatefulWidget {
  const PlayerPage({super.key});

  @override
  State<PlayerPage> createState() => _PlayerPageState();
}

class _PlayerPageState extends State<PlayerPage> {
  final _controller = TextEditingController();
  _PlayerState _state = _PlayerState.idle;
  String? _errorMessage;

  VideoPlayerController? _vpController;
  ChewieController? _chewieController;

  @override
  void dispose() {
    _disposePlayer();
    _controller.dispose();
    super.dispose();
  }

  void _disposePlayer() {
    _chewieController?.dispose();
    _vpController?.dispose();
    _chewieController = null;
    _vpController = null;
  }

  Future<void> _play() async {
    final videoId = _controller.text.trim();
    if (videoId.isEmpty) return;

    _disposePlayer();
    setState(() {
      _state = _PlayerState.loading;
      _errorMessage = null;
    });

    try {
      // 1. Ask backend for the HLS proxy URL
      final hlsUrl = await ApiService.instance.getPlaybackUrl(videoId);
      debugPrint('HLS URL: $hlsUrl');

      // 2. Initialise video_player (ExoPlayer on Android / AVPlayer on iOS — both support HLS)
      final vpController = VideoPlayerController.networkUrl(
        Uri.parse(hlsUrl),
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: false),
        httpHeaders: const {
          // Backend proxy needs no auth header; add if required later
        },
      );

      await vpController.initialize();

      final chewieController = ChewieController(
        videoPlayerController: vpController,
        autoPlay: true,
        looping: false,
        allowFullScreen: true,
        allowMuting: true,
        showControlsOnInitialize: true,
        placeholder: const Center(child: CircularProgressIndicator()),
        materialProgressColors: ChewieProgressColors(
          playedColor: const Color(0xFF0066FF),
          handleColor: Colors.white,
          backgroundColor: Colors.grey,
          bufferedColor: Colors.white38,
        ),
      );

      setState(() {
        _vpController = vpController;
        _chewieController = chewieController;
        _state = _PlayerState.playing;
      });
    } catch (e) {
      setState(() {
        _state = _PlayerState.error;
        _errorMessage = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Play Video'),
        centerTitle: true,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Video ID input
            TextField(
              controller: _controller,
              decoration: InputDecoration(
                labelText: 'Video ID',
                hintText: 'e.g. HudleVisionTeaser',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.play_circle_rounded),
                  tooltip: 'Play',
                  onPressed: _play,
                ),
              ),
              onSubmitted: (_) => _play(),
            ),

            const SizedBox(height: 16),

            FilledButton.icon(
              onPressed: _state == _PlayerState.loading ? null : _play,
              icon: _state == _PlayerState.loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.play_arrow_rounded),
              label: Text(_state == _PlayerState.loading ? 'Loading…' : 'Play'),
            ),

            const SizedBox(height: 24),

            // Player
            if (_state == _PlayerState.playing && _chewieController != null)
              AspectRatio(
                aspectRatio: _vpController!.value.aspectRatio,
                child: Chewie(controller: _chewieController!),
              ),

            // Error
            if (_state == _PlayerState.error && _errorMessage != null)
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
                        Text('Playback error',
                            style: theme.textTheme.titleSmall
                                ?.copyWith(color: Colors.red)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(_errorMessage!, style: theme.textTheme.bodySmall),
                  ],
                ),
              ),

            // Idle hint
            if (_state == _PlayerState.idle)
              Center(
                child: Column(
                  children: [
                    const SizedBox(height: 40),
                    Icon(Icons.smart_display_rounded,
                        size: 72,
                        color: theme.colorScheme.primary.withOpacity(0.4)),
                    const SizedBox(height: 16),
                    Text(
                      'Enter a Video ID and press Play\nto start adaptive HLS streaming',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

enum _PlayerState { idle, loading, playing, error }
