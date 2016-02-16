/*
 * Components of the Visual Query Builder (VQB)
 * --------------------------------------------
 *
 *
 * CPF (constant/property/function):
 *
 * cpf = {
 *   cpf_type: <string>,
 *   constant_value: <string>,
 *   property_name: <string>,
 *   function_name: <string>,
 *   function_args: [<cpf>, <cpf>, ...]
 * }
 *
 *
 * Structure of a query object:
 *
 * query = {
 *   stream: <string>,
 *   steps: [<step>, <step>, ...]
 * }
 *
 * step = {
 *   operation: <operation>
 * }
 *
 * TODO(derek): In the future, query should be a tree of operations, and the
 * stream name should be incorporated into a kstream access method operator.
 *
 * Sample operation:
 *
 * operation = {
 *   operator: 'aggregate',
 *   operands: {
 *     'aggregates': [<aggregation>, ...],
 *     'groups': [<group>, ...],
 *   }
 * }
 *
 * aggregation = {
 *   agg_type: <string>,
 *   agg_on: <cpf>,
 *   alias: <string>
 * }
 *
 * group = {
 *   field: <cpf>,
 *   alias: <string>
 * }
 *
 *
 * Schemas
 * -------
 * Keeping track of the schema is necessary for offering autocomplete on
 * property names. The schema must be flowed through the query, as each step
 * in the query has the ability to modify the schema for future steps. For
 * example, a transform operation adds a new property to the schema.
 *
 * Schemas are stored as object keys to emulate the behavior of sets.
 *
 * sample_schema = {"property1": true, "property2": true};
 *
 * `schemas[0]` is fed by `panel.cache.streamProperties`. The schema is then
 * flowed through all the steps of the query. Each step takes in
 * `schemas[index]`, makes modifications if necessary, and outputs results in
 * `schemas[index + 1]`. Because each step `$watch`es its input, and each
 * step's input is the previous step's output, a change anywhere will
 * immediately flow through all the following steps.
 *
 *
 * Validation
 * ----------
 * A validation object for the query builder is located at:
 * `panel.cache.query_builder.validation`. The keys of this object are the
 * validation complaint strings and the values are integer counts. Each time
 * the same complaint is filed, the count increments. This way, duplicate
 * validation failures (e.g. 'Field cannot be blank') are not displayed
 * multiple times to the user. The message disappears when all complaints of
 * that type have been revoked.
 *
 * vqbInvalid() can be called on a directive's scope to check if an error state
 * should be displayed in the UI (directive invalid && query has been run).
 */


var qb = angular.module('jia.querybuilder', []);

qb.value('findObjectInListBasedOnKey', function (list, keyName, keyVal) {
  for (var i = 0; i < list.length; i++) {
    if (list[i][keyName] == keyVal) {
      return list[i];
    }
  }
});

qb.value('makeComplaint', function (validation, complaint) {
  /*
   * File a complaint to a validation log. A count of each complaint type is
   * maintained so that the complaint can be removed from the log when the
   * number of remaining occurrences reaches 0.
   *
   * :param validation: A validation object. The keys are the complaints and
   * the values are the counts.
   * :param complaint: A string containing the validation complaint to be
   * shown to the user.
   */
  if (complaint in validation) {
    validation[complaint]++;
  }
  else {
    validation[complaint] = 1;
  }
});

qb.value('revokeComplaint', function (validation, complaint) {
  /*
   * Opposite of `makeComplaint`
   *
   * :param validation: A validation object. The keys are the complaints and
   * the values are the counts.
   * :param complaint: A string containing the validation complaint to be
   * shown to the user.
   */
  if (validation[complaint]) {
    validation[complaint]--;
    if (validation[complaint] == 0) {
      delete validation[complaint];
    }
  }
});

qb.value('EMPTY_COMPLAINT', 'One or more required fields are blank.');
qb.value('POS_INT_COMPLAINT', 'Limit must be a positive integer.');

qb.factory('nonEmpty', ['makeComplaint', 'revokeComplaint', 'EMPTY_COMPLAINT',
/*
 * Creates a validator for use with an ngModel $parser. Checks to make sure
 * model's value is defined and non-empty.
 */
function (makeComplaint, revokeComplaint, EMPTY_COMPLAINT) {
  return function (ngModel, validation, viewValue) {
    var complaint = 'One or more required fields are blank.';
    // If viewValue is undefined, some other validation failed. Therefore it's
    // not blank!
    if (typeof viewValue == 'undefined' || viewValue) {
      if (ngModel.$error['complete']) {
        revokeComplaint(validation, EMPTY_COMPLAINT);
      }
      ngModel.$setValidity('complete', true);
      return viewValue;
    }
    else {
      if (!ngModel.$error['complete']) {
        makeComplaint(validation, EMPTY_COMPLAINT);
      }
      ngModel.$setValidity('complete', false);
      return undefined;
    }
  };
}]);

qb.factory('posInt', ['makeComplaint', 'revokeComplaint', 'POS_INT_COMPLAINT',
/*
 * Creates a validator for use with an ngModel $parser. Zero is counted as a
 * positive integer.
 */
function (makeComplaint, revokeComplaint, POS_INT_COMPLAINT) {
  return function (ngModel, validation, viewValue) {
    var num = ~~Number(viewValue);
    if (String(num) === viewValue && num >= 0) {
      if (ngModel.$error['posInteger']) {
        revokeComplaint(validation, POS_INT_COMPLAINT);
      }
      ngModel.$setValidity('posInteger', true);
      return viewValue;
    }
    else {
      if (!ngModel.$error['posInteger']) {
        makeComplaint(validation, POS_INT_COMPLAINT);
      }
      ngModel.$setValidity('posInteger', false);
      return undefined;
    }
  };
}]);

qb.directive('querybuilder', function () {
  var controller = ['$scope', function($scope) {
    $scope.nextStep = {};
    $scope.query = $scope.panel.data_source.query;

    // Provide an empty schema set for `schemas[0]` as a placeholder until the
    // AJAX call to `infer_schema` returns a result.
    $scope.schemas = [{}];

    // Allow access from other places (like settings panel)
    $scope.panel.cache.schemas = $scope.schemas;

    $scope.$watch('panel.cache.streamProperties', function (newVal, oldVal) {
      if (newVal) {
        $scope.schemas[0] = {};
        for (var i = 0; i < newVal.length; i++) {
          $scope.schemas[0][newVal[i]] = true;
        }
      }
    });

    $scope.$watch('nextStep.operation', function (newVal, oldVal) {
      if (newVal && !_.isEmpty(newVal)) {
        var newStep = angular.copy($scope.nextStep);

        $scope.query.steps.push(newStep);
        $scope.nextStep = {};

        $scope.panel.cache.hasBeenRun = false;
      }
    });

    $scope.delete = function (step) {
      var index = $scope.query.steps.indexOf(step);
      if (index > -1) {
        $scope.query.steps.splice(index, 1);
      }
    };
  }];

  return {
    restrict: 'E',
    templateUrl: '/static/app/board/querybuilder.html',
    controller: controller,
  };
});

qb.directive('step', function ($http, $compile) {
  /*
   * Single query step
   */

  var controller = ['$scope', function($scope) {
    $scope.operations = [
      {
        name: 'Transform',
        operator: 'transform',
        operands: {}
      },
      {
        name: 'Filter',
        operator: 'filter',
        operands: {}
      },
      {
        name: 'Order by',
        operator: 'orderby',
        operands: {
          'fields': [{}]
        }
      },
      {
        name: 'Limit',
        operator: 'limit',
        operands: {}
      },
      {
        name: 'Aggregate',
        operator: 'aggregate',
        operands: {
          'aggregates': [{}],
          'groups': [{}]
        }
      }
    ];

    // If the step is not the "New operation..." add control, then it will
    // have an operation
    if ($scope.step.operation) {
      // Keep track of all new schema properties created during this step
      $scope.step.fields = [];

      // Make the input schema available to children who won't necessarily have
      // the correct $index
      $scope.schemaIndex = $scope.$index;

      // Initialize the output schema
      $scope.schemas[$scope.$index + 1] = {};

      // Changes to schemaIn require an update to the output schema in index+1
      $scope.$watch(function () {
        return $scope.schemas[$scope.$index];
      }, function (newVal, oldVal) {
        $scope.schemas[$scope.$index] = newVal;
        $scope.updateSchema();
      });

      // Any change to fields created in this query step requires an update
      $scope.$watch('step.fields', function () {
        $scope.updateSchema();
      }, true);

      $scope.addOperand = function (operands) {
        $scope.panel.cache.hasBeenRun = false;
        operands.push({});
      };

      $scope.removeOperand = function (idx, operands) {
        $scope.panel.cache.hasBeenRun = false;
        operands.splice(idx, 1);
      }

      $scope.replaceSchema = function () {
        /*
         * Create ouptut schema set containing only the new properties defined
         * in this query step
         */
        var schemaOut = {};
        for (var field in $scope.step.fields) {
          schemaOut[$scope.step.fields[field]] = true;
        }
        $scope.schemas[$scope.$index + 1] = schemaOut;
      };

      $scope.mergeSchema = function () {
        /*
         * Create output schema set containing the properties in the input
         * schema set in addition to the new properties defined in this query
         * step.
         */
        var schemaOut = angular.extend({}, $scope.schemas[$scope.$index]);
        for (var field in $scope.step.fields) {
          schemaOut[$scope.step.fields[field]] = true;
        }
        $scope.schemas[$scope.$index + 1] = schemaOut;
      };

      $scope.updateSchema = _.debounce(function () {
        /*
         * Select schema transform type based on the type of operation being
         * performed in this step.
         */
        if ($scope.step.operation.operator == 'aggregate') {
          $scope.replaceSchema();
        }
        else if ($scope.step.operation.operator == 'transform') {
          $scope.mergeSchema();
        }
        else {
          $scope.schemas[$scope.$index + 1] = $scope.schemas[$scope.$index];
        }
      }, 500);
      $scope.updateSchema();

      // If the operation type changes, the output schema needs an update
      $scope.$watch(function () {
        return $scope.step.operation;
      }, function (newVal, oldVal) {
        if (newVal) {
          $scope.updateSchema();
        }
      });
    }
  }];

  return {
    restrict: "E",
    templateUrl: '/static/app/board/step.html',
    controller: controller,
    scope: true
  };
});

qb.directive('cpf', ['findObjectInListBasedOnKey', 'makeComplaint',
                     'revokeComplaint', 'EMPTY_COMPLAINT',
function (findObjectInListBasedOnKey, makeComplaint, revokeComplaint,
          EMPTY_COMPLAINT) {
  /*
   * Constant/property/function
   *
   * See top of file for detailed information on the structure of the CPF
   * model.
   *
   * :param optional: If specified, the CPF will not be validated by nonEmpty
   *
   */
  var linker = function (scope, elem, attrs, ngModel) {
    // If no ng-model was supplied then nothing needs to be done.
    if (!ngModel) return;

    // Build a CPF data structure and upate the ng-model when the user changes
    // any of the inputs.
    scope.$watch(function () {
      return [scope.cpf.func,
              scope.cpf.type,
              scope.cpf.name,
              scope.cpf.value,
              scope.cpf.args];
    }, function () {
      var args = [];
      if (!scope.cpf.type) return;
      if (scope.cpf.args.length != scope.cpf.func.options.length) {
        scope.cpf.args = [];
      }
      _.each(scope.cpf.args, function (arg, index) {
        var type = scope.cpf.func.options[index].type;
        var cpf = {
          'cpf_type': type
        };
        if (type == 'property') {
          cpf['property_name'] = arg;
        }
        else if (type == 'constant') {
          cpf['constant_value'] = arg;
        }
        args.push(cpf);
      });
      var newVal = {
        cpf_type: scope.cpf.type.type,
        function_name: scope.cpf.func.value,
        function_args: args,
        property_name: scope.cpf.name,
        constant_value: scope.cpf.value
      };
      ngModel.$setViewValue(newVal);
    }, true);

    ngModel.$render = function () {
      var model = ngModel.$viewValue;
      if (!model) {
        ngModel.$setViewValue({});
      }
      else if (model.cpf_type) {
        scope.cpf.type = findObjectInListBasedOnKey(scope.types, 'type',
                                                    model.cpf_type);
        scope.cpf.func = findObjectInListBasedOnKey(scope.functions, 'value',
                                                    model.function_name);
        _.each(model.function_args, function (arg, index) {
          if ('property_name' in arg) {
            scope.cpf.args.push(arg.property_name);
          }
          else if ('constant_value' in arg) {
            scope.cpf.args.push(arg.constant_value);
          }
        });
        scope.cpf.name = model.property_name;
        scope.cpf.value = model.constant_value;
      }
    }

    if (attrs['optional'] === undefined || attrs['optional'] == 'false') {
      ngModel.$parsers.unshift(function (viewValue) {
        switch (viewValue.cpf_type) {
          case 'property':
            if (!viewValue.property_name) {
              if (!ngModel.$error['complete']) {
                makeComplaint(scope.panel.cache.query_builder.validation,
                              EMPTY_COMPLAINT);
              }
              ngModel.$setValidity('complete', false);
              return undefined;
            }
            else {
              if (ngModel.$error['complete']) {
                revokeComplaint(scope.panel.cache.query_builder.validation,
                                EMPTY_COMPLAINT);
              }
              ngModel.$setValidity('complete', true);
              return viewValue;
            }
            break;
          case 'constant':
              // Allow undefined constant values to pass validation; will be
              // processed as empty string
              revokeComplaint(scope.panel.cache.query_builder.validation,
                              EMPTY_COMPLAINT);
              ngModel.$setValidity('complete', true);
              return viewValue;
            break;
          case 'function':
            if (ngModel.$error['complete']) {
              revokeComplaint(scope.panel.cache.query_builder.validation,
                              EMPTY_COMPLAINT);
            }
            ngModel.$setValidity('complete', true);
            return viewValue;
            break;
        }
      });
    }

    scope.$on('$destroy', function () {
      if (!ngModel.$valid) {
        revokeComplaint(scope.panel.cache.query_builder.validation,
                        EMPTY_COMPLAINT);
      }
    });

    scope.vqbInvalid = function () {
      if (scope.panel.cache.hasBeenRun && !ngModel.$valid) {
        return true;
      }
      return false;
    };
  };

  var controller = ['$scope', function ($scope) {
    $scope.cpf = {};

    $scope.functions = [
      {
        name: 'Ceiling',
        value: 'Ceiling',
        options: [
          {name: 'Property', type: 'property'},
          {name: 'Base', type: 'constant'},
          {name: 'Offset', type: 'constant'}
        ]
      },
      {
        name: 'Floor',
        value: 'Floor',
        options: [
          {name: 'Property', type: 'property'},
          {name: 'Base', type: 'constant'},
          {name: 'Offset', type: 'constant'}
        ]
      },
      {
        name: 'Date Truncate',
        value: 'DateTrunc',
        options: [
          {name: 'Property', type: 'property'},
          {
            name: 'Time scale',
            type: 'constant',
            choices: [
              'second',
              'minute',
              'hour',
              'day',
              'week',
              'month',
              'year',
            ]
          }
        ]
      },
      {
        name: 'Date Part',
        value: 'DatePart',
        options: [
          {name: 'Property', type: 'property'},
          {
            name: 'Time scale',
            type: 'constant',
            choices: [
              'second',
              'minute',
              'hour',
              'weekday',
              'day',
              'month'
            ]
          }
        ]
      },
      {
        name: 'Lowercase',
        value: 'Lowercase',
        options: [
          {name: 'Property', type: 'property'}
        ]
      },
      {
        name: 'Uppercase',
        value: 'Uppercase',
        options: [
          {name: 'Property', type: 'property'}
        ]
      },
      {
        name: 'Random Integer',
        value: 'RandInt',
        options: [
          {name: 'Low', type: 'constant'},
          {name: 'High', type: 'constant'}
        ]
      }
      /*
       * TODO(derek): Missing functions
       *
       * or make an HTTP endpoint for determining this info
       */
    ];
    $scope.cpf.func = $scope.functions[0];

    $scope.types = [
      {name: 'Property', type: 'property'},
      {name: 'Constant', type: 'constant'},
      {name: 'Function', type: 'function'}
    ];
    $scope.cpf.type = $scope.types[0];
    $scope.cpf.value = '';
    $scope.cpf.args = [];
  }];

  return {
    restrict: "E",
    templateUrl: '/static/app/board/inputs/cpf.html',
    controller: controller,
    link: linker,
    scope: true,
    require: '?ngModel'
  };
}]);

qb.directive('op', ['findObjectInListBasedOnKey',
function (findObjectInListBasedOnKey) {
  /*
   * Basic filter operator type select element (lt, gt, gte, eq, etc)
   */
  var linker = function (scope, element, attrs, ngModel) {
    if (!ngModel) return;

    ngModel.$render = function () {
      if (ngModel.$viewValue) {
        var type = ngModel.$viewValue;
        scope.type = findObjectInListBasedOnKey(scope.types, 'value', type);
      }
      else {
        ngModel.$setViewValue(scope.type.value);
      }
    }

    scope.$watch('type', function () {
      if (scope.type != undefined) {
        ngModel.$setViewValue(scope.type.value);
      }
    });
  };

  var controller = ['$scope', function ($scope) {
    $scope.types = [
      {name: 'is less than', value: 'lt'},
      {name: 'is less than or equal to', value: 'lte'},
      {name: 'is greater than', value: 'gt'},
      {name: 'is greater than or equal to', value: 'gte'},
      {name: 'is equal to', value: 'eq'},
      {name: 'contains', value: 'contains'},
      {name: 'is in', value: 'in'},
      {name: 'matches regex', value: 'regex'}
    ];
    $scope.type = $scope.types[0];
  }];

  return {
    restrict: "E",
    templateUrl: '/static/app/board/inputs/op.html',
    controller: controller,
    link: linker,
    require: '?ngModel',
    scope: true
  };
}]);

qb.directive('aggtype', ['findObjectInListBasedOnKey',
function (findObjectInListBasedOnKey) {
  /*
   * Provides a dropdown list of aggregation types
   */
  var linker = function (scope, element, attrs, ngModel) {
    if (!ngModel) return;

    ngModel.$render = function () {
      if (ngModel.$viewValue) {
        var val = ngModel.$viewValue;
        scope.aggType = findObjectInListBasedOnKey(scope.aggTypes, 'value', val);
      }
      else {
        ngModel.$setViewValue({});
      }
    }

    scope.$watch('aggType', function () {
      if (scope.aggType != undefined) {
        ngModel.$setViewValue(scope.aggType.value);
      }
    });
  };

  var controller = ['$scope', function ($scope) {
    $scope.aggTypes = [
      {name: 'Minimum', value: 'Min'},
      {name: 'Maximum', value: 'Max'},
      {name: 'Average', value: 'Avg'},
      {name: 'Count', value: 'Count'},
      {name: 'Sum', value: 'Sum'},
      {name: 'Value count', value: 'Valuecount'}
    ];
    $scope.aggType = $scope.aggTypes[3];
  }];

  return {
    restrict: "E",
    templateUrl: '/static/app/board/inputs/aggtype.html',
    controller: controller,
    link: linker,
    require: '?ngModel',
    scope: true
  };
}]);

qb.directive('value', ['posInt', 'nonEmpty', 'revokeComplaint',
                       'EMPTY_COMPLAINT', 'POS_INT_COMPLAINT',
function (posInt, nonEmpty, revokeComplaint,
          EMPTY_COMPLAINT, POS_INT_COMPLAINT) {
  /*
   * Thin wrapper around <input>
   *
   * :param placeholder: (optional) Placeholder text for <input>
   * :param type: (optional) Declare type `posInt` for positive integer
   * validation
   * :param altersSchema: (optional) Indicates that this value is creating a
   * new property on the schema
   * :param optional: (optional) Indicates that this field is not required to
   * be filled in
   *
   * Example:
   * <value alters-schema placeholder="New field" type="text" optional></value>
   *
   */

  // Behaves statically because a directive's factory function is invoked only
  // once, when the compiler matches the directive for the first time.
  var id = 0;

  var linker = function (scope, element, attrs, ngModel) {
    if (attrs['placeholder']) {
      $(element).find('input').attr('placeholder', attrs['placeholder']);
    }

    scope.val = '';

    if (ngModel) {
      ngModel.$render = function () {
        if (ngModel.$viewValue) {
          scope.val = ngModel.$viewValue;
        }
        else {
          ngModel.$setViewValue(scope.val);
        }

        // Get unique ID from incrementing static `id`
        var uid = id++;
        scope.$watch('val', function () {
          ngModel.$setViewValue(scope.val);
          if ('altersSchema' in attrs) {
            scope.step.fields[uid] = scope.val;
          }
        });
      }

      if (attrs['type'] == 'posInt') {
        ngModel.$parsers.unshift(function (viewValue) {
          return posInt(ngModel, scope.panel.cache.query_builder.validation,
                        viewValue);
        });
      }

      if (attrs['optional'] === undefined || attrs['optional'] == 'false') {
        ngModel.$parsers.unshift(function (viewValue) {
          return nonEmpty(ngModel, scope.panel.cache.query_builder.validation,
                          viewValue);
        });
      }

      scope.vqbInvalid = function () {
        if (scope.panel.cache.hasBeenRun && !ngModel.$valid) {
          return true;
        }
        return false;
      };

      scope.$on('$destroy', function () {
        if (!ngModel.$valid) {
          revokeComplaint(scope.panel.cache.query_builder.validation,
                          EMPTY_COMPLAINT);
          revokeComplaint(scope.panel.cache.query_builder.validation,
                          POS_INT_COMPLAINT);
        }
      });
    }
  };

  return {
    restrict: "E",
    templateUrl: '/static/app/board/inputs/input.html',
    link: linker,
    scope: true,
    require: '?ngModel'
  };
}]);

qb.directive('direction', function () {
  /*
   * Sort order (asc/desc) select element
   */
  var linker = function (scope, element, attrs, ngModel) {
    scope.directions = [
      {name: 'Ascending', type: 'asc'},
      {name: 'Descending', type: 'desc'}
    ];

    ngModel.$render = function () {
      if (ngModel.$viewValue) {
        scope.direction = ngModel.$viewValue;
      }
      else {
        scope.direction = scope.directions[0];
      }
    }

    scope.$watch('direction', function () {
      ngModel.$setViewValue(scope.direction);
    });
  };

  return {
    restrict: "E",
    templateUrl: '/static/app/board/inputs/direction.html',
    link: linker,
    scope: true,
    require: '?ngModel'
  };
});

qb.directive('property', function () {
  /*
   * Autocomplete property name field
   *
   * :param model: Model to store property name in
   * :param schema: Schema set to extract keys from
   */
  var controller = ['$scope', function ($scope) {
    $scope.$watch('schema', function (newVal, oldVal) {
      if (newVal) {
        $scope.properties = Object.keys($scope.schema);
      }
    });
  }];
  return {
    restrict: 'E',
    templateUrl: '/static/app/board/inputs/property.html',
    controller: controller,
    scope: {
      model: '=',
      schema: '='
    }
  }
});
