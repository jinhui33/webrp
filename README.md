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

## Start the program

By default, this project runs in [Deno](https://deno.lang).

### Server

```sh
deno run server
```

### Client

```sh
deno run client
```
