# FFmpeg Lambda Layer

Place the static Linux FFmpeg binary at:

    layers/ffmpeg/bin/ffmpeg

Download a static build for Linux x86_64 from:
  https://johnvansickle.com/ffmpeg/

Make it executable before deploying:
  chmod +x layers/ffmpeg/bin/ffmpeg

The Lambda function expects FFmpeg at /opt/bin/ffmpeg at runtime.
Do NOT download FFmpeg inside the Lambda handler.
