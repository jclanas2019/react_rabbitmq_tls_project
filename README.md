# React + RabbitMQ TLS (TypeScript)

Proyecto full TypeScript:

- frontend React + TSX
- backend Express + TypeScript
- worker TypeScript
- conexión segura a RabbitMQ por TLS (`amqps://`)

---

## Supuesto técnico

RabbitMQ expone:

- 5671 → AMQP TLS
- 15671 → UI HTTPS

---

## Instalación RabbitMQ con TLS (Docker)

### 1. Crear estructura

mkdir -p rabbitmq/certs
cd rabbitmq

### 2. Generar certificados

# CA
openssl genrsa -out certs/ca.key 4096
openssl req -x509 -new -nodes -key certs/ca.key -sha256 -days 3650 -out certs/ca.pem -subj "/CN=RabbitMQ-Local-CA"

# SERVER
openssl genrsa -out certs/server.key 4096
openssl req -new -key certs/server.key -out certs/server.csr -subj "/CN=rabbitmq"

echo "subjectAltName=DNS:rabbitmq,DNS:localhost,IP:127.0.0.1" > certs/server.ext

openssl x509 -req -in certs/server.csr -CA certs/ca.pem -CAkey certs/ca.key -CAcreateserial -out certs/server.pem -days 825 -sha256 -extfile certs/server.ext

# CLIENT
openssl genrsa -out certs/client.key 4096
openssl req -new -key certs/client.key -out certs/client.csr -subj "/CN=client"
openssl x509 -req -in certs/client.csr -CA certs/ca.pem -CAkey certs/ca.key -CAcreateserial -out certs/client.pem -days 825 -sha256

---

## rabbitmq.conf

listeners.tcp = none
listeners.ssl.default = 5671

ssl_options.cacertfile = /certs/ca.pem
ssl_options.certfile   = /certs/server.pem
ssl_options.keyfile    = /certs/server.key
ssl_options.verify     = verify_peer
ssl_options.fail_if_no_peer_cert = true

management.ssl.port = 15671
management.ssl.cacertfile = /certs/ca.pem
management.ssl.certfile   = /certs/server.pem
management.ssl.keyfile    = /certs/server.key

---

## docker-compose.yml

version: "3.9"

services:
  rabbitmq:
    image: rabbitmq:3.13-management
    container_name: rabbitmq_tls
    ports:
      - "5671:5671"
      - "15671:15671"
    volumes:
      - ./certs:/certs
      - ./rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf

---

## Levantar

docker compose up -d

---

## Crear usuario

docker exec -it rabbitmq_tls rabbitmqctl add_user admin admin123
docker exec -it rabbitmq_tls rabbitmqctl set_permissions -p / admin ".*" ".*" ".*"

---

## Configuración backend (.env)

PORT=3002
RABBIT_QUEUE=form_queue

RABBIT_TLS_ENABLED=true
RABBIT_HOST=localhost
RABBIT_PORT=5671
RABBIT_USER=admin
RABBIT_PASSWORD=admin123
RABBIT_VHOST=/
RABBIT_SERVERNAME=localhost

RABBIT_TLS_CA_PATH=../certs/ca.pem
RABBIT_TLS_CERT_PATH=../certs/client.pem
RABBIT_TLS_KEY_PATH=../certs/client.key
RABBIT_TLS_REJECT_UNAUTHORIZED=true

---

## Ejecución

cd backend
npm install
npm run dev

---

## Validación TLS

openssl s_client -connect localhost:5671 -servername localhost -cert certs/client.pem -key certs/client.key -CAfile certs/ca.pem

Debe decir:
Verify return code: 0 (ok)

---

## Errores comunes

self-signed certificate in certificate chain
→ falta CA o no se envía client cert

tlsv1 alert certificate required
→ RabbitMQ exige mTLS

ACCESS_REFUSED
→ usuario/password/vhost incorrecto
