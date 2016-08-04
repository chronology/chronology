import bisect
import json
import sqlite3
from collections import defaultdict

from timeuuid import TimeUUID

from kronos.conf.constants import ID_FIELD
from kronos.conf.constants import MAX_LIMIT
from kronos.conf.constants import ResultOrder
from kronos.core import marshal
from kronos.storage.base import BaseStorage
from kronos.storage.memory.client import Event
from kronos.utils.uuid import uuid_from_kronos_time
from kronos.utils.uuid import UUIDType


# TODO(keir): Run EXPLAIN on the key queries and see what indices are used.
_CREATE_TABLE = [
  '''
  CREATE TABLE IF NOT EXISTS events (
     namespace TEXT,
     stream TEXT,
     time INTEGER,
     -- Human readable Time-UUID; e.g. 13814002-1DD2-11B2-8B4D-39F6F7E8A105.
     -- The UUIDs are lexicographically sortable.
     uuid TEXT,
     event BLOB)''',
  'CREATE INDEX IF NOT EXISTS idx ON events (namespace, stream, time)',
]


def flip_uuid_parts(uuid):
  """
  Flips high and low segments of the timestamp portion of a UUID string.
  This enables correct lexicographic sorting. Because it is a simple flip,
  this function works in both directions.
  """
  flipped_uuid = uuid.split('-')
  flipped_uuid[0], flipped_uuid[2] = flipped_uuid[2], flipped_uuid[0]
  flipped_uuid = '-'.join(flipped_uuid)
  return flipped_uuid


def sortable_time_uuid_str(uuid):
  """
  Returns a string representation of a time UUID with the high and low
  segments flipped to enable correct lexicographic sorting.
  """
  return flip_uuid_parts(str(uuid))


class SqliteStorage(BaseStorage):
  SETTINGS_VALIDATORS = {
    'sqlite_database_path': lambda x: True,
  }

  def __init__(self, name, namespaces, **settings):
    super(SqliteStorage, self).__init__(name, namespaces, **settings)
    self.connection = sqlite3.connect(settings['sqlite_database_path'])
    self.cursor = self.connection.cursor()
    map(self.cursor.execute, _CREATE_TABLE)

  def is_alive(self):
    return True

  def _insert(self, namespace, stream, events, configuration):
    self.cursor.executemany(
        'INSERT INTO events VALUES (?, ?, ?, ?, ?)',
        ((namespace, stream, _id.time, tuuid_id_str(_id), json.dumps(event))
         for _id, event in events))
    self.connection.commit()
    return self.cursor.rowcount

  def _delete(self, namespace, stream, start_id, end_time, configuration):
    end_id = uuid_from_kronos_time(end_time, _type=UUIDType.HIGHEST)
    self.cursor.execute('''
        DELETE FROM events
        WHERE namespace = ? AND
              stream = ? AND
              ((time = ? AND uuid > ?) OR
               (time > ? AND time <= ?))''',
        (namespace,
         stream,
         start_id.time,
         sortable_time_uuid_str(start_id),
         start_id.time,
         end_id.time))
    rowcount = self.cursor.rowcount
    self.connection.commit()
    return rowcount, []

  def _retrieve(self, namespace, stream, start_id, end_time, order, limit,
                configuration):
    start_id_event = Event(start_id)
    end_id = uuid_from_kronos_time(end_time, _type=UUIDType.HIGHEST)
    direction = 'ASC' if order == ResultOrder.ASCENDING else 'DESC'

    for event, in self.cursor.execute('''
        SELECT event FROM events
        WHERE namespace = ? AND
              stream = ? AND
              ((time = ? AND uuid > ?) OR
               (time > ? AND time <= ?))
        ORDER BY time %s, uuid %s''' % (direction, direction),
        (namespace,
         stream,
         start_id.time,
         sortable_time_uuid_str(start_id),
         start_id.time,
         end_id.time)):
      if limit == 0:
        return
      else:
        limit -= 1
      yield event

  def _streams(self, namespace):
    for stream, in self.cursor.execute(
        'SELECT DISTINCT stream FROM events WHERE namespace=?', (namespace,)):
      yield stream

  def _clear(self):
    self.cursor.execute('DELETE FROM events')
    self.connection.commit()
