import amqp, { Channel, Connection, Options } from "amqplib";
import fs from "node:fs";
import path from "node:path";

const QUEUE = process.env.RABBIT_QUEUE || "form_queue";
const TLS_ENABLED = (process.env.RABBIT_TLS_ENABLED || "true").toLowerCase() === "true";
const RABBIT_HOST = process.env.RABBIT_HOST || "localhost";
const RABBIT_PORT = Number(process.env.RABBIT_PORT || (TLS_ENABLED ? "5671" : "5672"));
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

function readFileIfExists(filePath: string): Buffer | undefined {
  if (!filePath) return undefined;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No existe el archivo TLS: ${resolved}`);
  }
  return fs.readFileSync(resolved);
}

async function connectRabbit(): Promise<Channel> {
  if (channel) return channel;

  const socketOptions: Options.Connect = {
    protocol: TLS_ENABLED ? "amqps" : "amqp",
    hostname: RABBIT_HOST,
    port: RABBIT_PORT,
    username: RABBIT_USER,
    password: RABBIT_PASSWORD,
    vhost: RABBIT_VHOST,
    heartbeat: 30,
  };

  if (TLS_ENABLED) {
    socketOptions.servername = RABBIT_SERVERNAME;
    socketOptions.rejectUnauthorized = TLS_REJECT_UNAUTHORIZED;

    const ca = readFileIfExists(TLS_CA_PATH);
    const cert = readFileIfExists(TLS_CERT_PATH);
    const key = readFileIfExists(TLS_KEY_PATH);

    if (ca) socketOptions.ca = [ca];
    if (cert) socketOptions.cert = cert;
    if (key) socketOptions.key = key;
    if (TLS_PASSPHRASE) socketOptions.passphrase = TLS_PASSPHRASE;
  }

  connection = await amqp.connect(socketOptions);
  connection.on("error", (err) => {
    console.error("RabbitMQ connection error:", err);
    channel = null;
    connection = null;
  });
  connection.on("close", () => {
    console.error("RabbitMQ connection closed");
    channel = null;
    connection = null;
  });

  channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });

  console.log(
    `Worker conectado por ${TLS_ENABLED ? "TLS" : "AMQP"} en ${RABBIT_HOST}:${RABBIT_PORT}, cola=${QUEUE}`
  );

  return channel;
}

async function start(): Promise<void> {
  const currentChannel = await connectRabbit();

  await currentChannel.consume(QUEUE, (msg) => {
    if (!msg) return;

    try {
      const content = JSON.parse(msg.content.toString());
      console.log("Procesando:", content);
      currentChannel.ack(msg);
    } catch (error) {
      console.error("Error procesando mensaje:", error);
      currentChannel.nack(msg, false, false);
    }
  });
}

start().catch((error) => {
  console.error("Fallo inicializando worker:", error);
  process.exit(1);
});
