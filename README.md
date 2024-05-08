# Nakama Game of Goose

Authoritative Nakama game server in Typescript

- to be used with [godot-game-of-goose](https://github.com/JosePedroDias/godot-game-of-goose)

## setup

This folder is meant to be used in a nakama instance.

Download one of the docker compose recipes from [here](https://heroiclabs.com/docs/nakama/getting-started/install/docker/).

Download and start docker desktop or similar.

Check out this inside data/modules.

    npm install
    npm run build

This should create data/modules/goose.js

Edit `docker-compose.yml`.
In the `nakama` service entrypoint, be sure to change/append the nakama run command so that `--runtime.js_entrypoint "goose.js"`

Ex:

    /nakama/nakama migrate up --database.address root@cockroachdb:26257 &&
    exec /nakama/nakama --database.address root@cockroachdb:26257 --runtime.js_entrypoint "goose.js"

    docker compose up

Everything going well:

- you should see in the nakama logs that the goose module was loaded

    {"level":"info","ts":"2024-05-08T21:51:57.586Z","caller":"server/runtime_javascript.go:634","msg":"Initialising JavaScript runtime provider","path":"/nakama/data/modules","entrypoint":"goose.js"}

- and by visiting [the runtime modules page]() both the `goose.js` should be listed on the Javascript modules and `goose_match` should be listed in the RPC functions list.

The default configuration of [godot-game-of-goose](https://github.com/JosePedroDias/godot-game-of-goose) points to this default http instance on localhost.
