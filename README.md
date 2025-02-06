# WebRP (Web Reverse Proxy)

A web-based Reverse Proxy for locally deployed web services to bypass NAT
without the need of an ECS.

## Concept

This project includes a server and a client, which communicate via WebSocket.

The server can be run in a cloud-based ECS, an Edge Computing service such as
Deno Deploy and Cloudflare Workers, or anywhere that is reachable on the
Internet.

The server transfer all HTTP requests to the client, who will eventually proxy
them to the local service.

Multiple clients can be deployed at the same time, the server will distribute
network traffic accordingly.

## Configuration

The program uses environment variables for configuration, we can set them in a
`.env` file.

### Common Client Env

```ini
CLIENT_ID=mac@home # A unique identifier of the proxy client
REMOTE_URL=http://localhost:8000 # The base URL of the proxy server
LOCAL_URL=http://localhost:11434 # The base URL of the local HTTP server
```

### Authentication

#### Connection Token

We can set the `CONN_TOKEN` to instruct a handshake negotiation for the proxy
server and proxy client, both sides must set this variable to the same value.

#### Request Token

We can set the `AUTH_TOKEN` on the server side to instruct the server that it
will only proxy the request if it has a `Authorization` header set to the same
value.

## Start the program

By default, this project runs in [Deno](https://deno.lang).

### Server (CLI)

```sh
deno task server
```

The above command is used to start the server in a physical machine or an ECS,
Edge Computing services or hosting services have their own ways to start the
server, whatever they are, the entry file is `server/main.ts`.

### Client

```sh
deno task client
```

## Common Errors

### 503 No proxy client

If there are clients running, and this error still occurs, it's probably because
the proxy client and the user agent connect to different servers, which is
common if the proxy server is deployed on Deno Deploy or Cloudflare Workers, or
other Edge Computing services, where network traffic are redirected to the
server close to the user agent.

Make sure that the proxy client and the user agent are connecting to the same
server, use a VPN if must.
