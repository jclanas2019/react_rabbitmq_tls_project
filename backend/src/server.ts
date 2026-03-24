import express, { Request, Response } from "express";
import amqp, { Channel, Connection } from "amqplib";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ override: true });

const app = express();
app.use(cors());
app.use(express.json());

const QUEUE = process.env.RABBIT_QUEUE || "form_queue";
const PORT = Number(process.env.PORT || 3002);

const TLS_ENABLED =
  (process.env.RABBIT_TLS_ENABLED || "true").toLowerCase() === "true";

const RABBIT_HOST = process.env.RABBIT_HOST || "localhost";
const RABBIT_PORT = Number(
  process.env.RABBIT_PORT || (TLS_ENABLED ? "5671" : "5672")
);
const RABBIT_USER = process.env.RABBIT_USER || "guest";
const RABBIT_PASSWORD = process.env.RABBIT_PASSWORD || "guest";
const RABBIT_VHOST = process.env.RABBIT_VHOST || "/";
const RABBIT_SERVERNAME = process.env.RABBIT_SERVERNAME || RABBIT_HOST;

const TLS_CA_PATH = process.env.RABBIT_TLS_CA_PATH || "";
const TLS_CERT_PATH = process.env.RABBIT_TLS_CERT_PATH || "";
const TLS_KEY_PATH = process.env.RABBIT_TLS_KEY_PATH || "";
const TLS_PASSPHRASE = process.env.RABBIT_TLS_PASSPHRASE || "";
const TLS_REJECT_UNAUTHORIZED =
  (process.env.RABBIT_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() === "true";

let connection: Connection | null = null;
let channel: Channel | null = null;
let connectingPromise: Promise<Channel> | null = null;

function resolveFile(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function readRequiredFile(filePath: string, label: string): Buffer {
  if (!filePath) {
    throw new Error(`Falta configurar ${label}`);
  }

  const resolved = resolveFile(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No existe ${label}: ${resolved}`);
  }

  return fs.readFileSync(resolved);
}

function getDebugConfig() {
  return {
    queue: QUEUE,
    port: PORT,
    tlsEnabled: TLS_ENABLED,
    rabbitHost: RABBIT_HOST,
    rabbitPort: RABBIT_PORT,
    rabbitUser: RABBIT_USER,
    rabbitVhost: RABBIT_VHOST,
    rabbitServername: RABBIT_SERVERNAME,
    tlsRejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
    tlsCaPath: TLS_CA_PATH || null,
    tlsCaExists: TLS_CA_PATH ? fs.existsSync(resolveFile(TLS_CA_PATH)) : false,
    tlsCertPath: TLS_CERT_PATH || null,
    tlsCertExists: TLS_CERT_PATH ? fs.existsSync(resolveFile(TLS_CERT_PATH)) : false,
    tlsKeyPath: TLS_KEY_PATH || null,
    tlsKeyExists: TLS_KEY_PATH ? fs.existsSync(resolveFile(TLS_KEY_PATH)) : false,
  };
}

function buildAmqpUrl(): string {
  const protocol = TLS_ENABLED ? "amqps" : "amqp";
  const user = encodeURIComponent(RABBIT_USER);
  const pass = encodeURIComponent(RABBIT_PASSWORD);

  let vhost = RABBIT_VHOST || "/";
  if (vhost === "/") {
    vhost = "%2F";
  } else {
    vhost = encodeURIComponent(vhost);
  }

  return `${protocol}://${user}:${pass}@${RABBIT_HOST}:${RABBIT_PORT}/${vhost}`;
}

async function createRabbitChannel(): Promise<Channel> {
  const amqpUrl = buildAmqpUrl();

  const socketOptions: Record<string, unknown> = {
    servername: RABBIT_SERVERNAME,
    rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
    heartbeat: 30,
    timeout: 10000,
  };

  if (TLS_ENABLED) {
    const ca = readRequiredFile(TLS_CA_PATH, "RABBIT_TLS_CA_PATH");
    const cert = readRequiredFile(TLS_CERT_PATH, "RABBIT_TLS_CERT_PATH");
    const key = readRequiredFile(TLS_KEY_PATH, "RABBIT_TLS_KEY_PATH");

    socketOptions.ca = [ca];
    socketOptions.cert = cert;
    socketOptions.key = key;

    if (TLS_PASSPHRASE) {
      socketOptions.passphrase = TLS_PASSPHRASE;
    }
  }

  console.log("[rabbit] intentando conectar", getDebugConfig());
  console.log("[rabbit] url", amqpUrl.replace(/:\/\/.*@/, "://***:***@"));
  console.log("[rabbit] tls efectiva", {
    servername: socketOptions.servername,
    rejectUnauthorized: socketOptions.rejectUnauthorized,
    hasCa: Array.isArray(socketOptions.ca) ? socketOptions.ca.length > 0 : false,
    hasCert: Boolean(socketOptions.cert),
    hasKey: Boolean(socketOptions.key),
    hasPassphrase: Boolean(socketOptions.passphrase),
  });

  const conn = await amqp.connect(amqpUrl, socketOptions);
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE, { durable: true });

  conn.on("error", (err) => {
    console.error("[rabbit] connection error:", err);
    if (connection === conn) {
      connection = null;
      channel = null;
    }
  });

  conn.on("close", () => {
    console.error("[rabbit] connection closed");
    if (connection === conn) {
      connection = null;
      channel = null;
    }
  });

  ch.on("error", (err) => {
    console.error("[rabbit] channel error:", err);
    if (channel === ch) {
      channel = null;
    }
  });

  ch.on("close", () => {
    console.error("[rabbit] channel closed");
    if (channel === ch) {
      channel = null;
    }
  });

  connection = conn;
  channel = ch;

  console.log("[rabbit] conectado OK");
  return ch;
}

async function connectRabbit(): Promise<Channel> {
  if (channel) return channel;
  if (connectingPromise) return connectingPromise;

  connectingPromise = createRabbitChannel()
    .catch((error) => {
      connection = null;
      channel = null;
      throw error;
    })
    .finally(() => {
      connectingPromise = null;
    });

  return connectingPromise;
}

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await connectRabbit();
    return res.json({ ok: true, debug: getDebugConfig() });
  } catch (error) {
    console.error("[health] error:", error);
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "unknown error",
      stack: error instanceof Error ? error.stack : null,
      debug: getDebugConfig(),
    });
  }
});

app.post("/submit", async (req: Request, res: Response) => {
  const payload = req.body as { name?: string; message?: string };

  if (!payload?.name?.trim() || !payload?.message?.trim()) {
    return res.status(400).json({
      ok: false,
      error: "name y message son obligatorios",
    });
  }

  try {
    const currentChannel = await connectRabbit();

    const message = {
      id: crypto.randomUUID(),
      name: payload.name.trim(),
      message: payload.message.trim(),
      createdAt: new Date().toISOString(),
    };

    const sent = currentChannel.sendToQueue(
      QUEUE,
      Buffer.from(JSON.stringify(message)),
      { persistent: true, contentType: "application/json" }
    );

    return res.json({ ok: true, queued: sent, messageId: message.id });
  } catch (error) {
    console.error("[submit] error:", error);
    return res.status(500).json({
      ok: false,
      error: "Error enviando mensaje a RabbitMQ",
      detail: error instanceof Error ? error.message : "unknown error",
      stack: error instanceof Error ? error.stack : null,
      debug: getDebugConfig(),
    });
  }
});

app.listen(PORT, () => {
  console.log(`[api] corriendo en http://localhost:${PORT}`);
  console.log("[api] config efectiva", getDebugConfig());
});