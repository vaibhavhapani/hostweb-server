const express = require("express");
const { generateSlug } = require("random-word-slugs");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
const { Server } = require("socket.io");
const Redis = require("ioredis");
require('dotenv').config();
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT | 9000;
const IO_PORT = process.env.SOCKET_PORT | 9001;
const S3_PROXY_PORT = process.env.S3_PROXY_PORT | 8000;

const subscriber = new Redis(process.env.REDIS_SERVER_AUTH);
const io = new Server({ cors: "*" });

io.on("connection", (socket) => {
  socket.on("subscribe", (channel) => {
    socket.join(channel);
    socket.emit("message", `Joined ${channel}`);
    console.log(`Joined ${channel}`);
  });
});

io.listen(IO_PORT, () => console.log(`Socket server running on ${IO_PORT}`));

const ecsClient = new ECSClient({
  region: process.env.AWS_USER_REGION,
  credentials: {
    accessKeyId: process.env.AWS_USER_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_USER_SECRET_ACCESS_KEY,
  },
});

const config = {
  CLUSTER: process.env.ECS_CLUSTER_ARN,
  TASK: process.env.ECS_TASK_ARN,
};

app.post("/project", async (req, res) => {
  const { gitURL, slug } = req.body;
  const projectSlug = slug ? slug : generateSlug();

  const command = new RunTaskCommand({
    cluster: config.CLUSTER,
    taskDefinition: config.TASK,
    launchType: "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",
        subnets: [
          process.env.TASK_SUBNET1,
          process.env.TASK_SUBNET2,
          process.env.TASK_SUBNET3,
        ],
        securityGroups: [process.env.TASK_SECURITY_GROUP1],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: process.env.CONTAINER_IMAGE_NAME,
          environment: [
            {
              name: "GIT_REPOSITORY_URL",
              value: gitURL,
            },
            {
              name: "PROJECT_ID",
              value: projectSlug,
            },
          ],
        },
      ],
    },
  });

  await ecsClient.send(command);

  return res.json({
    status: "queued",
    data: { projectSlug, url: `http://${projectSlug}.localhost:${S3_PROXY_PORT}` },
  });
});

async function initRedisSubscribe() {
  subscriber.psubscribe("logs:*");
  subscriber.on("pmessage", (pattern, channel, message) => {
    const data = JSON.parse(message);
    const log = data.log;
    console.log(channel);
    io.to(channel).emit("message", log);
    console.log(log);
  });
}

initRedisSubscribe();

app.listen(PORT, () => {
  console.log(`API server running at..${PORT}`);
});
