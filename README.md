# NAT Web Reverse Proxy

A Reverse Proxy for locally deployed web services to bypass NAT without the need
of an ECS.

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

The client program uses environment variables for configuration, we can set them
in a `.env` file

```ini
AGENT_ID=mac@home # A unique identifier of the proxy client
REMOTE_URL=http://localhost:8000 # The base URL of the proxy server
LOCAL_URL=http://localhost:11434 # The base URL of the local HTTP server
```

There is no configuration for the server.

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

### 503 Service Unavailable

If there are clients running, and this error still occurs, it's probably because
the proxy client and the user agent connect to different servers, which is
common if the proxy server is deployed on Deno Deploy or Cloudflare Workers, or
other Edge Computing services, where network traffic are redirected to the
server close to the user agent.

To solve this problem, we can manually set the domain name of proxy server to a
static address in the `/etc/hosts` file so the proxy client will always connect
to a known server.

However, for user agents, if they are mobile phones, I don't know if there is a
way to do so.
