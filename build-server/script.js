const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const mime = require("mime-types");
require('dotenv').config();
const Redis = require("ioredis");

const publisher = new Redis(process.env.REDIS_SERVER_AUTH);

const PROJECT_ID = process.env.PROJECT_ID;

function publishLog(log) {
  publisher.publish("logs:", JSON.stringify({ log }));
}

const s3Client = new S3Client({
  region: process.env.AWS_USER_REGION,
  credentials: {
    accessKeyId: process.env.AWS_USER_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_USER_SECRET_ACCESS_KEY,
  },
});

async function init() {
  console.log("Executing script.js");  
  publishLog("Build Started...");

  const outDirPath = path.join(__dirname, "output");
  const process = exec(
    `cd ${outDirPath} && npm install && npm run build && ls`
  );

  process.stdout.on("data", function (data) {
    console.log(data.toString());
    publishLog(data.toString());
  });

  process.stderr.on("error", function (data) {
    console.log("Error", data.toString());
    publishLog(`error: ${data.toString()}`);
  });

  process.on("close", async function () {
    console.log("Build Complete");
    publishLog("Build Complete");

    const distFolderPath = path.join(__dirname, "output", "dist");
    const distFolderContents = fs.readdirSync(distFolderPath, {
      recursive: true,
    });

    publishLog("Starting to upload");
    for (const file of distFolderContents) {
      const filePath = path.join(distFolderPath, file);
      if (fs.lstatSync(filePath).isDirectory()) continue;

      console.log("uploading... ", filePath);
      publishLog(`uploading ${filePath}`);

      const command = new PutObjectCommand({
        Bucket: "noob-vercel-clone",
        Key: `__outputs/${PROJECT_ID}/${file}`,
        Body: fs.createReadStream(filePath),
        ContentType: mime.lookup(filePath),
      });

      await s3Client.send(command);

      console.log("uploaded", filePath);
      publishLog(`uploaded ${filePath}`);
    }

    console.log("Done.");
    publishLog("Done.");
    publisher.disconnect();
  });
}

init();
