"use strict";

const { BatchClient, SubmitJobCommand } = require("@aws-sdk/client-batch");

const batch = new BatchClient({
  region: process.env.AWS_REGION || "ap-south-1",
});

exports.handler = async (event) => {
  if (process.env.STAGE === "local") {
    console.log("Skipping Batch job submission in local stage.");
    return;
  }

  const record = event.Records?.[0];
  if (!record?.s3) {
    console.warn("No S3 record present in event.");
    return;
  }

  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  if (!key.startsWith("originals/")) {
    console.log("Skipping non-originals key:", key);
    return;
  }

  if (!process.env.BATCH_JOB_QUEUE || !process.env.BATCH_JOB_DEFINITION) {
    throw new Error("Batch job configuration is missing from environment.");
  }

  const videoId =
    key.split("/").pop().split(".").slice(0, -1).join(".") || "video";
  const jobName = `${sanitize(videoId)}-${Date.now()}`.slice(0, 128);

  const response = await batch.send(
    new SubmitJobCommand({
      jobName,
      jobQueue: process.env.BATCH_JOB_QUEUE,
      jobDefinition: process.env.BATCH_JOB_DEFINITION,
      containerOverrides: {
        environment: [
          { name: "SOURCE_BUCKET", value: bucket },
          { name: "SOURCE_KEY", value: key },
          { name: "AWS_REGION", value: process.env.AWS_REGION || "ap-south-1" },
        ],
      },
      timeout: {
        attemptDurationSeconds: 7200,
      },
    }),
  );

  console.log("Submitted AWS Batch transcoding job", {
    jobId: response.jobId,
    jobName: response.jobName,
    bucket,
    key,
  });
};

function sanitize(value) {
  return value.replace(/[^A-Za-z0-9-_]/g, "-").replace(/-+/g, "-");
}
