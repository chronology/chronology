import copy
import json
import metis.core.query.aggregate
import metis.core.query.value
from flask import current_app
from metis.core.query.aggregate import GroupBy
from metis.core.query.condition import Condition
from metis.core.query.operator import Aggregate
from metis.core.query.operator import DataAccess
from metis.core.query.operator import Filter
from metis.core.query.operator import Limit
from metis.core.query.operator import OrderBy
from metis.core.query.operator import Project
from metis.core.query.value import Constant
from metis.core.query.value import Property


def cpf(args, alias=None):
  if args['cpf_type'] == 'constant':
    try:
      constant = float(args['constant_value'])
    except:
      constant = args['constant_value']
    return Constant(constant, alias=alias)
  elif args['cpf_type'] == 'property':
    return Property(args['property_name'], alias=alias)
  elif args['cpf_type'] == 'function':
    for i in range(len(args['function_args'])):
      args['function_args'][i] = cpf(args['function_args'][i])
    module = metis.core.query.value
    func = args['function_name']
    func_args = args['function_args']
    return getattr(module, func)(func_args, alias=alias)
  else:
    raise ValueError("cpf_type must be constant, property, or function")


def transform(query_plan, operands):
  fields = [cpf(operands['value'], alias=operands['newProperty'])]
  return Project(query_plan, fields, merge=True)


def filter(query_plan, operands):
  condition = Condition(operands['op'], cpf(operands['lhs']),
                        cpf(operands['rhs']))
  return Filter(query_plan, condition)


def agg_op(agg_type, agg_on, store_in):
  module = metis.core.query.aggregate
  op = agg_type
  agg_ons = []
  if agg_on:
    agg_ons.append(agg_on)
  return getattr(module, op)(agg_ons, alias=store_in)


def aggregate(query_plan, operands):
  aggregates = []

  for agg in operands['aggregates']:
    cpf_type = agg['agg_on']['cpf_type']
    property_name = agg['agg_on'].get('property_name')
    constant_value = agg['agg_on'].get('constant_value')
    empty = (cpf_type == 'property' and not property_name or
             cpf_type == 'constant' and not constant_value)
    if empty:
      agg_on_cpf = None
    else:
      agg_on_cpf = cpf(agg['agg_on'])
    aggregates.append(agg_op(agg['agg_type'], agg_on_cpf, agg['alias']))

  groups = []
  for group in operands['groups']:
    groups.append(cpf(group['field'], group['alias']))

  group_by = GroupBy(groups)
  return Aggregate(query_plan, group_by, aggregates)


def orderby(query_plan, operands):
  fields = []
  for field in operands['fields']:
    fields.append(cpf(field['name']))
  if operands['order']['type'] == 'asc':
    order = OrderBy.ResultOrder.ASCENDING
  else:
    order = OrderBy.ResultOrder.DESCENDING
  return OrderBy(query_plan, fields, order=order)


def limit(query_plan, operands):
  return Limit(query_plan, int(operands['count']))


def create_metis_query_plan(query, start_time, end_time):
  query = copy.deepcopy(query)

  query_plan = {
    'type': 'data_access',
    'source': current_app.config['DATA_SOURCE_NAME'],
    'stream': query['stream'],
    'start_time': start_time,
    'end_time': end_time,
  }

  operators = {
    'transform': transform,
    'filter': filter,
    'aggregate': aggregate,
    'orderby': orderby,
    'limit': limit,
  }

  for step in query['steps']:
    operation = step['operation']
    operator = operation['operator']
    operands = operation['operands']
    query_plan = operators[operator](query_plan, operands)

  if not isinstance(query_plan, dict):
    query_plan = query_plan.to_dict()

  return json.dumps({'plan': query_plan})
