#!/bin/sh

set -e

LOGDIR=/var/log/kronos
LOGFILE=$LOGDIR/uwsgi.log
LIBDIR=/usr/lib/kronos

(cd $LIBDIR/uwsgi && ./uwsgi --ini /etc/uwsgi/kronos.ini --logto $LOGFILE)
