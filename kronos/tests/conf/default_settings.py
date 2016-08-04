import re
import os

from uuid import getnode

from kronos.conf.constants import ServingMode

debug = True
profile = False
serving_mode = ServingMode.ALL

storage_backends_with_external_dependencies = {
  'cassandra': {
    'backend': 'kronos.storage.cassandra.CassandraStorage',
    'hosts': ['127.0.0.1'],
    'keyspace_prefix': 'kronos_test',
    # Set to a value greater than 0 or you will get an UnavailableException
    'replication_factor': 1,
    'timewidth_seconds': 2,  # Keep this small for test environment.
    'shards_per_bucket': 3,
    'read_size': 10
  },
  'elasticsearch': {
    'backend': 'kronos.storage.elasticsearch.ElasticSearchStorage',
    'hosts': [{'host': 'localhost', 'port': 9200}],
    'index_template': 'kronos_test',
    'index_prefix': 'kronos_test',
    'shards': 1,
    'replicas': 0,
    'force_refresh': True,
    'read_size': 10,
    'rollover_size': 100,
    'rollover_check_period_seconds': 2
  }
}

storage = {
  'memory': {
    'backend': 'kronos.storage.memory.InMemoryStorage',
    'max_items': 50000
  },
  'sqlite': {
    'backend': 'kronos.storage.sqlite.SqliteStorage',
    'sqlite_database_path': '/tmp/kronos.sqlite'
  }
}

if not os.environ.get('DISABLE_KRONOS_BACKENDS_WITH_DEPENDENCIES'):
  storage.update(storage_backends_with_external_dependencies)

node = {
  'id': hex(getnode()),
  'flush_size': 512,
  'greenlet_pool_size': 50,
  'gipc_pool_size': 2,
  'log_directory': 'logs',
  'cors_whitelist_domains': map(re.compile, ['localhost'])
}

stream = {
  'format': re.compile(r'^[a-z0-9\_]+(\.[a-z0-9\_]+)*$', re.I)
}

default_namespace = 'kronos'

_default_stream_configuration = {
  '': {
    'backends': {
      'memory': None
    },
    'read_backend': 'memory'
  }
}

namespace_to_streams_configuration = {
  default_namespace: _default_stream_configuration,
  'namespace1': _default_stream_configuration,
  'namespace2': _default_stream_configuration
}
