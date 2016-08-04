#Deploying with Docker

## Quick usage HOWTO

We've already pushed a working [Docker image to Docker
Hub](https://registry.hub.docker.com/u/chronology/metis/), so you can do
something like the following:

First, create a `settings.py` file with your metis settings. Here is an
[example settings
file](https://github.com/Locu/chronology/blob/master/metis/metis/conf/default_settings.py).

```bash
  export PUBLIC_PORT=80
  mkdir -p logs
  # assuming `settings.py` is in your current directory
  sudo docker run -d -v $PWD:/etc/metis -v $PWD/logs:/var/log/metis/ -p $PUBLIC_PORT:80 chronology/metis
```

## How to build/push future versions

  * `./build.sh [git hash or tag you want to build] chronology/metis:v[version]`
  * `python ../../docker_tools/manage_docker.py push --tag chronology/metis:v[version]`
