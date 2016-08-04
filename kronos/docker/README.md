#Deploying with Docker

## Quick usage HOWTO

We've already pushed a working [Docker image to Docker
Hub](https://registry.hub.docker.com/u/chronology/kronos/), so you can do
something like the following:

First, create a `settings.py` file with your kronos settings. Here is an
[example settings
file](https://github.com/Locu/chronology/blob/master/kronos/kronos/conf/default_settings.py).

```bash
  export PUBLIC_PORT=80
  mkdir -p logs
  # assuming `settings.py` is in your current directory
  sudo docker run -d -v $PWD:/etc/kronos -v $PWD/logs:/var/log/kronos -p $PUBLIC_PORT:80 chronology/kronos
```

If you are interested in running the `elasticsearch` or `cassandra` backends
the following dockers might also be helpful:

[Cassandra Docker](https://github.com/tobert/cassandra-docker)

[ElasticSearch Docker](https://github.com/dockerfile/elasticsearch)

## How to build/push future versions

  * `./build.sh [git hash or tag you want to build] chronology/kronos:v[version]`
  * `python ../../docker_tools/manage_docker.py push --tag chronology/kronos:v[version]`

Note: Docker aggressively caches commands for performance. To avoid this, in
build.sh, add --no-cache option to `manage_docker.py build.`
