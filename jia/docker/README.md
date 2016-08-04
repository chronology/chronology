#Deploying with Docker

## Quick usage HOWTO

We've already pushed a working [Docker image to Docker
Hub](https://registry.hub.docker.com/u/chronology/jia/), so you can do
something like the following:

First, create a `settings.py` file with your jia settings. Here is an [example
settings
file](https://github.com/Locu/chronology/blob/master/jia/jia/conf/default_settings.py).

```bash
  export PUBLIC_PORT=80
  mkdir -p logs
  # assuming `settings.py` is in your current directory
  sudo docker run -d -v $PWD:/etc/jia -v $PWD/logs:/var/log/jia/ -p $PUBLIC_PORT:80 chronology/jia
```
## How to build/push future versions

  * `./build.sh [git hash or tag you want to build] chronology/jia:v[version]`
  * `python ../../docker_tools/manage_docker.py push --tag chronology/jia:v[version]`
