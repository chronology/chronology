#!/bin/sh

python ../../docker_tools/manage_docker.py export --hash $1 --export-path $(git rev-parse --show-toplevel)/metis/docker/chronology --repository-path $(git rev-parse --show-toplevel)
python ../../docker_tools/manage_docker.py build --dockerfile-directory . --tag $2
