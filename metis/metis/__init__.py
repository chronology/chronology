from gevent import monkey; monkey.patch_all()

import os

VERSION = (0, 1, 'alpha')


def get_version(version=None):
  version = version or VERSION
  assert(len(version) == 3)
  return '%s.%s %s' % version


# The file path will have `metis.zip` in it if its being run on Spark workers.
# In that case we don't want to run the following initialization code because
# it can (and does) break things.
if 'metis.zip' in str(__file__):
  app = None
else:
  from flask import Flask

  METIS_PATH = os.path.realpath(os.path.dirname(__file__))

  app = Flask(__name__)
  app.config.from_pyfile('%s/conf/default_settings.py' % METIS_PATH)
  app.config['PATH'] = METIS_PATH

  import metis.views  # noqa
