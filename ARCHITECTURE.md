Adaptive Streaming POC — Serverless Version (RAW)

Stack:
Backend: NestJS
Processing: AWS Lambda
Infra: Serverless Framework
Storage: S3
Transcoding: FFmpeg
Streaming: HLS

==================================================
PREREQUISITES

Install Serverless Framework:

npm install -g serverless

Configure AWS credentials:

aws configure

==================================================
PROJECT STRUCTURE

video-streaming-poc/

lambda/
handler.js

layers/
ffmpeg/
bin/
ffmpeg

serverless.yml
package.json

==================================================
S3 STRUCTURE (AUTO-CREATED)

Bucket name:

video-streaming-poc-${stage}

Folders:

originals/ → uploaded videos
processed/ → transcoded output

==================================================
SERVERLESS.YML

service: video-streaming-poc

frameworkVersion: "3"

provider:
name: aws
runtime: nodejs18.x
region: ap-south-1
memorySize: 2048
timeout: 900

iam:
role:
statements:
- Effect: Allow
Action:
- s3:*
Resource: "*"

layers:
ffmpeg:
path: layers/ffmpeg
name: ffmpeg-layer
description: Static FFmpeg binary

functions:
transcoder:
handler: lambda/handler.handler
layers:
- { Ref: FfmpegLambdaLayer }
```
events:
  - s3:
      bucket: video-streaming-poc-${sls:stage}
      event: s3:ObjectCreated:*
      rules:
        - prefix: originals/
      existing: false
```
resources:
Resources:
VideoBucket:
Type: AWS::S3::Bucket
Properties:
BucketName: video-streaming-poc-${sls:stage}

==================================================
LAMBDA TRANSCODER — lambda/handler.js

const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const s3 = new AWS.S3();
const FFmpeg = "/opt/bin/ffmpeg";

exports.handler = async (event) => {
const record = event.Records[0];
const bucket = record.s3.bucket.name;
const key = decodeURIComponent(record.s3.object.key.replace(/+/g, " "));

if (!key.startsWith("originals/")) return;

const fileName = path.basename(key);
const videoId = fileName.split(".")[0];
const inputPath = /tmp/${fileName};

console.log("Downloading:", key);

const obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
fs.writeFileSync(inputPath, obj.Body);

const outputDir = /tmp/output;
fs.mkdirSync(outputDir);

const renditions = [
{ name: "360p", scale: "640:360", bitrate: "800k" },
{ name: "480p", scale: "854:480", bitrate: "1200k" },
{ name: "720p", scale: "1280:720", bitrate: "2500k" },
];

const variants = [];

for (const r of renditions) {
const outPath = ${outputDir}/${r.name};
fs.mkdirSync(outPath);
```
const cmd = `
  ${FFmpeg} -y -i ${inputPath}
  -vf scale=${r.scale}
  -c:a aac -b:a 128k
  -c:v h264 -preset veryfast
  -b:v ${r.bitrate}
  -hls_time 4
  -hls_playlist_type vod
  -hls_segment_filename ${outPath}/seg_%03d.ts
  ${outPath}/playlist.m3u8
`;

execSync(cmd);

variants.push({
  bandwidth: parseInt(r.bitrate) * 1000,
  resolution: r.scale,
  uri: `${r.name}/playlist.m3u8`,
});
}
```
let master = "#EXTM3U\n";

for (const v of variants) {
master += #EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.resolution}\n${v.uri}\n;
}

fs.writeFileSync(${outputDir}/master.m3u8, master);

const files = fs.readdirSync(outputDir, { recursive: true });

for (const file of files) {
const full = path.join(outputDir, file);
if (fs.statSync(full).isDirectory()) continue;
```
await s3.putObject({
  Bucket: bucket,
  Key: `processed/${videoId}/${file}`,
  Body: fs.readFileSync(full),
  ContentType: file.endsWith(".m3u8")
    ? "application/vnd.apple.mpegurl"
    : "video/MP2T",
}).promise();
```
}
console.log("Done");
};

==================================================
FFMPEG LAMBDA LAYER SETUP

Folder:

layers/ffmpeg/bin/ffmpeg

Download static binary from:

https://johnvansickle.com/ffmpeg/

Make executable:

chmod +x ffmpeg

==================================================
DEPLOY COMMAND

serverless deploy --stage dev

==================================================
TEST FLOW

Upload video to:

originals/myvideo.mp4

Lambda runs automatically

Output appears:

processed/myvideo/

Stream using:

https://<bucket>.s3.amazonaws.com/processed/myvideo/master.m3u8

==================================================
RESULT

Upload → Auto Transcode → HLS → Adaptive Streaming Ready