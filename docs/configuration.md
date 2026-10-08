# Configuration

No credentials are required. Configuration controls where data is stored, which address accepts connections, and which routing service is used.

The defaults work without a configuration file. You can export variables in your shell, or optionally copy `.envrc.example` to `.envrc` and run `direnv allow`. With direnv installed and hooked into your shell, it loads those exports when you enter the directory. A separate `.env` file is not needed.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` for direct Bun execution | Address on which the application server listens. Compose sets it to `0.0.0.0` inside the container. |
| `PORT` | `3000` | Server port when running Bun directly; published host port with Compose. The container always uses port 3000 internally. |
| `DATA_DIR` | `data` for Bun, `./data` on the Compose host | Local archive directory. Compose mounts it at `/data` in the container. |
| `BIND_ADDRESS` | `127.0.0.1` | Compose host address on which the port is published. |
| `DOCKER_USER` | `1000:1000` | Numeric user and group for the application container. Set this to the owner of the host archive directory. |
| `OSRM_URL` | `https://routing.openstreetmap.de/routed-car` | Routing base URL; the server appends `/route/v1/driving/{coordinates}`. |
| `OSRM_TIMEOUT_MS` | `5000` | Routing request timeout in milliseconds, from 100 to 30000. |

`HOST` and `BIND_ADDRESS` serve different purposes: changing `HOST` in your shell does not change which host address Compose publishes.

## Private network access

In the repository directory on the Docker host:

```sh
mkdir -p data
export DATA_DIR="$PWD/data"
export DOCKER_USER="$(id -u):$(id -g)"
export BIND_ADDRESS=0.0.0.0
export PORT=3000
docker compose config
docker compose up -d --build
```

Open `http://HOST-IP:3000`. The application has no login or account management. Restrict access to a trusted private network or VPN; do not expose it through an unrestricted public proxy or internet port forwarding.

Choose a stable host address and enable host/guest startup if you run it in a virtual machine or system container.

## Data directory and ownership

Use an absolute host path for a custom `DATA_DIR` and a local filesystem, not a network share. The directory must exist before Compose starts and must be writable by `DOCKER_USER`. The bind mount does not create a missing host directory.

Variables exported in one terminal disappear in a new shell. Keep custom settings in your private `.envrc`, load it with direnv, or export the same settings before every Compose command. Keep the same Compose project name for startup, backup, and updates; if using `-p`, include it consistently.

Never commit your archive, actual exports, private configuration, or backups. The default `data/`, common database files, private CSVs, `.envrc`, and local planning directory are ignored. An arbitrary custom data directory still needs its own ignore rule or must live outside the repository.

## Routing

The default routing service is public. Opening a suitable trip can transmit its endpoints to that service. Successful results are cached in the archive directory. For a different service, set `OSRM_URL` before starting the server or recreating the application container.

Inside Docker, a routing URL must be reachable from the container; `127.0.0.1` refers to the container itself. Automated tests use controlled local HTTP fixtures and never query a public routing service.

## Troubleshooting

```sh
docker compose ps --all
docker compose logs --tail=100 fahrtenbuch
```

Check the host directory's ownership, a free published port, and the loaded Compose configuration if startup fails. Logs include startup, import counts, and error types, without CSV contents or coordinates. Log files are rotated by Compose.
