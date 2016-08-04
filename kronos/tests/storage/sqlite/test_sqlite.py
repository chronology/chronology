import datetime
from tests.server import KronosServerTestCase
from kronos.storage.sqlite.client import sortable_time_uuid_str
from kronos.storage.sqlite.client import flip_uuid_parts
from kronos.utils.uuid import uuid_from_kronos_time  
from pykronos.common.time import datetime_to_kronos_time

class TestSQLiteBackend(KronosServerTestCase):

  def test_lex_sort(self):
    """
    This test ensures that the UUID segment flip enables correct lexicographic
    sorting of the v1 time UUIDs used.

    The timespan tested is 230 years so that the high bits in the time UUID must
    differ.
    """
    seconds = 230 * 365 * 24 * 60 * 60

    uuids = []
    for idx, sec in enumerate(range(0, seconds, 7250000)):
      dt = datetime.datetime.now() + datetime.timedelta(seconds=sec)
      kt = datetime_to_kronos_time(dt)
      event1 = uuid_from_kronos_time(kt)
      event2 = uuid_from_kronos_time(kt)
      events = sorted([event1, event2])
      uuids.append(events[0])
      uuids.append(events[1])

    uuids = [str(uuid) for uuid in uuids]
    flipped_uuids = [sortable_time_uuid_str(uuid) for uuid in uuids] 
    flipped_uuids = sorted(flipped_uuids)
    flipped_uuids = [flip_uuid_parts(uuid) for uuid in flipped_uuids]

    self.assertEqual(uuids, flipped_uuids)

