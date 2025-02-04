# OLLaMA Reverse Proxy

An OLLaMA Reverse Proxy that bypasses NAT and don't require an ECS.

## Concept

This project includes a server and a client, which communicate via WebSocket or
HTTP (Server Sent Events).

The server proxies all Ollama API calls to the client, who will eventually proxy
the request to Ollama runs locally alongside with the client.

The server can be run in a cloud-based ECS, an Edge Computing services such as
Deno Deploy and Cloudflare Workers, or anywhere that is reachable on the
Internet.

The client must be run in the computer that has Ollama installed and started.
Multiple clients can be deployed at the same time, the server will distribute
network traffic accordingly.

## Configuration

The program uses environment variables for configuration, we can set them in a
`.env` file, or in the config page of the deploy service (for server).

```ini
# Client
TRANSPORT=ws # 'ws' (default) or 'sse'
AGENT_ID=mac@home # A unique identifier of the client
SERVER_URL=http://localhost:8000 # The URL of the proxy server
OLLAMA_URL=http://localhost:11434 # The URL of the Ollama API server

# Server
AUTH_TOKEN=your_token # Optional, a private key for API verification
```

## Start the program (CLI)

By default, this project runs in [Deno](https://deno.lang).

### Server

```sh
deno task server
```

### Client

```sh
deno task client
```

## Common Errors

### 401 Unauthorized

This error will occur when we set the `AUTH_TOKEN` environment variable on the
server but do not provide an `Authorization` header when calling the Ollama API,
or the two doesn't match.

Just set the correct `Authorization` header to the same value as `AUTH_TOKEN`
when calling the Ollama API, this error will disappear.

### 503 No agents available

If there are clients running, and this error still shows, it's probably because
the proxy client and the AI App connect to different servers, which is common if
the proxy server is deployed on Deno Deploy or Cloudflare Workers, or other Edge
Computing services, where network traffic are redirected to the server close to
the user agent.

To solve this problem, we can manually set the domain name of proxy server to a
static address in the `/etc/hosts` file so the proxy client will always connect
to a known server. However, I don't know if there is a way to do so on mobile
phones.
