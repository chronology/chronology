from metis.core.execute import python
from metis.core.execute.python import PythonExecutor
from metis.core.execute.spark import SparkExecutor
from metis.core.query.adapter import DataSourceAdapter
from metis.core.query.kronos import KronosSource
from pykronos.client import KronosClient

class Python(DataSourceAdapter):
  @classmethod
  def executor_source_pair(self):
    return (PythonExecutor, KronosSource)

  def execute(self, node, executor):
    client = KronosClient(node._host, blocking=True)
    return client.get(node.stream,
                      node.start_time,
                      node.end_time,
                      namespace=node._namespace)

class Spark(DataSourceAdapter):
  @classmethod
  def executor_source_pair(self):
    return (SparkExecutor, KronosSource)

  def execute(self, node, executor):
    delta = (node.end_time - node.start_time) / executor.parallelism

    def get_events(i):
      client = KronosClient(node._host, blocking=True)
      start_time = node.start_time + (i * delta)
      if i == executor.parallelism - 1:
        end_time = node.end_time
      else:
        end_time = start_time + delta - 1
      return list(client.get(node.stream,
                             start_time,
                             end_time,
                             namespace=node._namespace))

    # XXX(usmanm): Does this preserve ordering? I ran a few simulations and it
    # seems like ordering is preserved. Need to test on a multi-node cluster as
    # well.
    parallelize = executor.context.parallelize(range(executor.parallelism))
    return parallelize.flatMap(get_events)
