# WebRP (Web Reverse Proxy)

A web-based Reverse Proxy for locally deployed web services to bypass NAT
without the need of an ECS.

## Concept

This project includes a server and a client, which communicate via WebSocket.

The server can be run in a cloud-based ECS, an Edge Computing service such as
Deno Deploy, or other kind of hosting service.

_(NOTE: Cloudflare Workers is not supported at the moment, since it_
_`Cannot perform I/O` across different requests.)_

The server transfer all HTTP requests to the client, who will eventually proxy
them to the local service.

Multiple clients can be deployed at the same time, the server will distribute
network traffic accordingly.

## Configuration

The program uses environment variables for configuration, we can set them in a
`.env` file.

### Common Client Env

```ini
CLIENT_ID=mac@home # A unique identifier of the proxy client.
REMOTE_URL=http://localhost:8000 # The base URL of the proxy server.
LOCAL_URL=http://localhost:11434 # The base URL of the local HTTP server.
PING_INTERVAL=30 # Optional, ping interval in seconds, shall not be less than 5.
```

### Authentication

#### Connection Token

We can set the `CONN_TOKEN` to instruct a handshake negotiation for the proxy
server and proxy client, both sides must set this variable to the same value.

#### Request Token

We can set the `AUTH_TOKEN` on the server side to instruct the server that it
will only proxy the request if one of these headers is set to the same value:

- `X-Auth-Token`
- `Authorization`

`X-Auth-Token` is preferred, since `Authorization` may be used by the proxied
service itself. A `Bearer` prefix may be attached.

Additionally, `AUTH_RULE` is used to instruct which path should be tested for
authentication, the value is a regular expression, for example:

```ini
AUTH_RULE=^\/api\/ # Require auth for API endpoints.
```

### Forward Host

By default, the request to the local web service will include an
`X-Forwarded-Host` header, which contains the proxy server's host address, and
leave the `Host` header to be the local address.

We can, however, turn `on` the `FORWARD_HOST` setting on the server side to
instruct the proxy program not to set the `X-Forwarded-Host` header and use
`Host` to store the proxy server's address instead.

## Deploy the Server

### Deno Deploy

Fork this repository and sign into Deno Deploy, follow the deployment guidance,
select the forked repository and set the entry point to `server/main.ts`.

### ECS or Physical/Virtual Machine

Clone this repository and use the CLI to start the proxy server.

```sh
deno install
deno task server
# or
npm install
npm run server
# or
bun install
bun run server/main.ts
```

### Restricted Node.js Hosting Services

This is for Node.js Hosting Services where we don't manage the server ourselves,
similar to Deno Deploy but for Node.js applications.

Clone this repository on a physical machine, install [Bun](https://bun.sh). Run
the following commands to build and bundle the program.

```sh
bun install
bun build
```

Upload `dist/server.js` to the hosting service and set the entry point to
`dist/server.js` (depends on where the file is located).

### Start the Client

Clone this repository in a machine behind a NAT, and use the following commands
to start the proxy client.

```sh
deno install
deno task client
# or
npm install
npm run client
# or
bun install
bun run client/main.ts
```

## Common Errors

### 503 No proxy client

If there are clients running, and this error still occurs, it's probably because
the proxy client and the user agent connect to different servers, which is
common if the proxy server is deployed on Deno Deploy or other Edge Computing
services, where network traffic are redirected to the server close to the user
agent.

Make sure that the proxy client and the user agent are connecting to the same
server, use a VPN if must.

However, the deploy service may spawn multiple server instances for busy network
traffics, if the user agent and the proxy client connects to different
instances, there is nothing we can do.
