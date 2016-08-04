var app = angular.module('jia.board', ['ngSanitize',
                                       'ui.codemirror',
                                       'ui.bootstrap',
                                       'ui.bootstrap.datetimepicker',
                                       'ui.select',
                                       'selecter',
                                       'jia.querybuilder',
                                       'jia.navigation',
                                       'jia.vis.timeseries',
                                       'jia.vis.table',
                                       'jia.vis.gauge',
                                       'jia.vis.barchart'
                                      ]);

// Add data to acceptable hrefs for CSV to be generated client side
app.config(['$compileProvider', function($compileProvider) {
  $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|data):/);
}]);

app.factory('BoardTransport', function () {
  /*
   * A simple storage service (store an object with setData/getData) used for
   * transporting board data between controllers during a route change.
   */
  var emptyBoard = {
    title: '',
    panels: []
  };
  var data = angular.copy(emptyBoard);
  return {
    setData: function (newData) {
      data = newData;
    },
    getData: function () {
      return data;
    },
    reset: function () {
      data = angular.copy(emptyBoard);
    }
  };
});

app.factory('BoardService', ['$http', '$q', function ($http, $q) {
  var BoardService = {};
  BoardService.data = {};

  BoardService.getBoards = function () {
    var deferred = $q.defer();
    $http.get('/boards')
      .success(function(data, status, headers, config) {
        deferred.resolve(data.boards);
      });
    return deferred.promise;
  };

  return BoardService;
}]);

app.config(function(uiSelectConfig) {
  uiSelectConfig.theme = 'bootstrap';
});

app.controller('BoardController',
['$scope', '$http', '$location', '$timeout', '$injector', '$routeParams',
 '$sce', '$sanitize', '$modal', '$rootScope', 'BoardTransport', 'BoardService',
 'ToolbarButtonService', 'makeComplaint', 'revokeComplaint',
function ($scope, $http, $location, $timeout, $injector, $routeParams,
          $sce, $sanitize, $modal, $rootScope, BoardTransport, BoardService,
          ToolbarButtonService, makeComplaint, revokeComplaint) {
  // TODO(marcua): Re-add the sweet periodic UI refresh logic I cut
  // out of @usmanm's code in the Angular rewrite.
  $scope.boardId = $routeParams.boardId;
  $scope.showCodeToggle = JIA_ALLOW_PYCODE;
  $scope.dataSource = '/static/app/board/sources/' + JIA_DATA_SOURCE + '.html';

  $scope.editorOptions = {
    lineWrapping: true,
    lineNumbers: true,
    mode: 'python',
    theme: 'mdn-like',
  };

  $scope.timeScales = [
    {name: 'seconds'},
    {name: 'minutes'},
    {name: 'hours'},
    {name: 'days'},
    {name: 'weeks'},
    {name: 'months'},
    {name: 'years'}
  ];

  $scope.timeframeModes = [
    {name: 'Most recent', value: 'recent'},
    {name: 'Date range', value: 'range'}
  ];

  $scope.bucketWidthHelpText = 'If you are aggregating events, pick a bucket '+
                               'width that is equal to or a multiple of the '+
                               'timeframe you are aggregating on. For '+
                               'example, if computing a 5-minute average, '+
                               'computation should be bucketed in intervals '+
                               'like 5 or 10. Picking non-positive or '+
                               'non-integer multiples of the bucket width '+
                               'will cause incorrect results.';
 
  this.loadVisualizations = function () {
    var visualizations = {};
    _.each(app.requires, function (dependency) {
      if (dependency.indexOf('jia.vis.') == 0) {
        module = dependency.substring('jia.vis.'.length);
        visualizations[module] = $injector.get(module);
      }
    });
    return visualizations;
  };

  $scope.visualizations = this.loadVisualizations();

  $scope.log = function () {
    this.infos = [];
    this.info = function (message, code) {
      this.write(this.infos, message, code);
    };

    this.warns = [];
    this.warn = function (message, code) {
      this.write(this.warns, message, code);
    };

    this.errors = [];
    this.error = function (message, code) {
      this.write(this.errors, message, code);
    };

    this.write = function (log, message, code) {
      message = message.replace(/\</g, '&lt;').replace(/\>/g, '&gt;');
      message = $sanitize(message);
      if (code) {
        message = "<pre>" + message + "</pre>";
      }
      log.push($sce.trustAsHtml(message));
    }

    this.clear = function () {
      this.infos = [];
      this.warns = [];
      this.errors = [];
    };
  };

  $scope.changeVisualization = function(panel, type) {
    // Avoid calling setData if the user selects the type that is already
    // being viewed
    if (type.meta.title != panel.display.display_type) {
      panel.cache.log.clear();
      panel.display.display_type = type.meta.title;
      panel.cache.visualizations[type.meta.title] = new type.visualization();
      panel.cache.visualization = panel.cache.visualizations[type.meta.title];
      panel.display.settings = panel.cache.visualization.settings;
      panel.cache.visualization.setData(panel.cache.data, panel.cache.log);
    }
    panel.cache.visualizationDropdownOpen = false;
  };

  $scope.updateSchema = function (panel) {
    $http.get('/streams/' + panel.data_source.query.stream)
      .success(function (data, status, headers, config) {
        panel.cache.streamProperties = Object.keys(data.properties);
      }
    );
  }

  var checkSchema = function (panel) {
    var data = panel.cache.data;
    var requiredFields = panel.display.settings.requiredFields;
    var keys = [];

    if (!data.events.length) {
      panel.cache.schemaNeedsTransform = false;
      return keys;
    }

    for (key in requiredFields) {
      if (requiredFields.hasOwnProperty(key)) {
        if (typeof data['events'][0][requiredFields[key]] == 'undefined') {
          panel.cache.schemaNeedsTransform = true;
          keys.push(key);
        }
      }
    }

    if (keys.length) {
      panel.cache.schemaNeedsTransform = true;
    }
    else {
      panel.cache.schemaNeedsTransform = false;
    }

    return keys;
  }

  $scope.toggleVisualizationSettingsOpen = function (panel) {
    if (panel.cache.visualizationSettingsOpen) {
      $scope.closeVisualizationSettings(panel);
    }
    else {
      panel.cache.visualizationSettingsOpen = true;
    }
  };

  $scope.closeVisualizationSettings = function (panel) {
    var missing = checkSchema(panel);
    panel.cache.log.clear();
    if (panel.cache.schemaNeedsTransform) {
      panel.cache.log.error('Query schema does not fulfill required inputs.');
      _.each(missing, function (field) {
        panel.cache.log.error('Missing ' + field +
                              ': no property in query result called ' + 
                              panel.display.settings.requiredFields[field]);
      });
      var availableProperties = [];
      _.each(panel.cache.data.events[0], function (obj, key) {
        availableProperties.push(key);
      });
      panel.cache.log.info('Available properties: ' +
                           availableProperties.join(', '));
      panel.cache.log.info('Sample event:');
      panel.cache.log.info(JSON.stringify(panel.cache.data.events[0],
                                          null, '  '), true);
    }
    else {
      panel.cache.visualizationSettingsOpen = false;
      panel.cache.visualization.setData(panel.cache.data, panel.cache.log);
    }
  };

  $scope.VQBHasErrors = function (panel) {
    if (panel.data_source.source_type != 'querybuilder') {
      return false;
    }
    return Object.keys(panel.cache.query_builder.validation).length > 0;
  };

  $scope.callAllSources = function() {
    _.each($scope.boardData.panels, function(panel) {
      $scope.callSource(panel);
    });
  };

  $scope.callSource = function(panel) {
    panel.cache.loading = true;
    panel.cache.log.clear();
    panel.cache.hasBeenRun = true;

    if ($scope.VQBHasErrors(panel)) {
      panel.cache.loading = false;
      return;
    }

    $http.post('/callsource', panel.data_source)
      .success(function(data, status, headers, config) {
        panel.cache.data = data;
        if (!data['events']) {
          panel.cache.log.error('Invalid response from server.');
          return;
        }
        if (!data['events'].length) {
          panel.cache.log.warn('Query result contains no events.');
        }
        checkSchema(panel);
        if (panel.cache.schemaNeedsTransform) {
          panel.cache.visualizationSettingsOpen = true;
          return;
        }
        panel.cache.visualization.setData(data, panel.cache.log);

        // If autorefresh, schedule the next run
        if (panel.data_source.autorefresh.enabled &&
            panel.data_source.timeframe.mode.value == 'recent') {
          var interval = panel.data_source.autorefresh.interval * 1000;
          window.setTimeout($scope.callSource, interval, panel);
        }
      })
      .error(function(data, status, headers, config) {
        if (status == 400) {
          if (panel.data_source.source_type == 'querybuilder') {
            panel.cache.log.error('An unexpected error occurred while running'+
                                  ' the query.');
          }
          else {
            panel.cache.log.error(data.message);
            panel.cache.log.error(data.data.name + ": " + data.data.message);
            var traceback = "";
            _.each(data.data.traceback, function (trace) {
              traceback += trace;
            });
            panel.cache.log.error(traceback, true);
          }
        }
        else if (status == 500) {
          panel.cache.log.error("Internal server error");
        }
        else {
          panel.cache.log.error("Could not reach server");
        }
      })
      .finally(function() {
        panel.cache.loading = false;
      });
  };
  
  $scope.downloadCSV = function (panel, event) {
    var csv = []; // CSV represented as 2D array
    var headerString = 'data:text/csv;charset=utf-8,';
    
    try {
      var data = panel.cache.data.events;
      if (!data.length) {
        throw "No data";
      }
    } catch (e) {
      event.target.href = headerString;
      return;
    }

    // Create line for titles
    var titles = Object.keys(data[0]);
    csv.push([]);
    for (var title in titles) {
      csv[0].push(titles[title]);
    }

    // Add all dictionary values
    for (var i in data) {
      var row = data[i];
      var newRow = [];
      for (var j in row) {
        var point = row[j];
        newRow.push(point);
      }
      csv.push(newRow);
    }

    var csvString = '';

    for (var i in csv) {
      var row = csv[i];
      for (var j in row) {
        var cell = row[j] === null ? '' : row[j].toString();
        var result = cell.replace(/"/g, '""');
        if (result.search(/("|,|\n)/g) >= 0) {
          result = '"' + result + '"';
        }
        if (j > 0) {
          csvString += ',';
        }
        csvString += result;
      }
      csvString += '\n';
    }

    if (event.target.tagName == 'SPAN') {
      rewrite = event.target.parentNode;
    }
    else {
      rewrite = event.target;
    }
    rewrite.href = headerString + encodeURIComponent(csvString);
  };

  $scope.cleanBoard = function () {
    // Deep copy the board data and remove the cached data.
    if (!$scope.boardData) {
      return undefined;
    }
    return JSON.parse(JSON.stringify($scope.boardData, function(key, value) {
      if (key === 'cache') {
        return undefined;
      }
      return value;
    }));
  }

  $scope.saveBoard = function() {
    if ($scope.boardData.title == "") {
      $scope.missingTitle = true;
      $('html, body').animate({ scrollTop: 0}, 'slow');
      return;
    }

    var data = $scope.cleanBoard();

    // TODO(marcua): display something on save failure.
    $http.post('/board/' + $scope.boardId, data)
      .success(function(data, status, headers, config) {
        $scope.boardHasChanges = false;
        if ($scope.boardId = 'new'){
          $scope.boardId = data.id;
          $location.path('/boards/' + $scope.boardId);
        }
        $scope.getBoards();
      })
      .error(function(data, status, headers, config) {
        console.log('error!');
      });
  };

  $scope.panelSettingsModal = function (panel, index) {
    var scope = $scope.$new();
    scope.panel = panel;
    scope.$index = index;
    $scope.panelSettingsModalInstance = $modal.open({
      templateUrl: 'static/app/board/modals/panelsettings.html',
      scope: scope,
      size: 'lg'
    });
  };

  $scope.duplicateBoardModal = function () {
    $scope.duplicateBoardName = 'Duplicate of ' + $scope.boardData.title;
    $scope.duplicateBoardModalInstance = $modal.open({
      templateUrl: 'static/app/board/modals/nameduplicate.html',
      scope: $scope 
    });
  };

  $scope.duplicateBoard = function (newTitle) {
    var copyData = {};
    jQuery.extend(copyData, $scope.boardData); 
    copyData['title'] = newTitle;
    BoardTransport.setData(copyData);
    $location.path('/boards/new');
    $scope.duplicateBoardModalInstance.close();
  };

  $scope.deletePanel = function (index) {
    var title = $scope.boardData.panels[index].title || 'untitled';
    var message = 'Are you sure you wish to delete the ' + title + ' panel?';
    if (confirm(message)) {
      $scope.boardData.panels.splice(index, 1);
      $scope.panelSettingsModalInstance.close();
    }
  }
  
  $scope.deleteBoard = function () {
    var title = $scope.boardData.title || "this board";
    if (confirm("Are you sure you want to delete " + title + "?")) {
      $http.post('/board/' + $scope.boardId + '/delete')
        .success(function (data, status, headers, config) {
          if (data.status == 'success') {
            $scope.deleting = true;
            $location.path('/boards');
          }
        });
    }
  };

  $scope.initPanel = function(panel) {
    panel.cache = {
      data: {events: []},
      visualizations: {},
      log: new $scope.log(),
      schemaNeedsTransform: false
    };

    // Avoid any board data format incompatibilities by initalizing
    // unset fields
    var defaultPanel = $scope.newPanelObj();
    var setDefaults = function (obj, defaults) {
      _.each(defaults, function (element, key) {
        if (typeof obj[key] == 'undefined') {
          obj[key] = element;
        }
        if (typeof obj[key] == 'object') {
          setDefaults(obj[key], element);
        }
      });
    };
    setDefaults(panel, defaultPanel);

    // Initialize the active visualization type
    var visualizationType = panel.display.display_type;
    var selectedVisualization = $scope.visualizations[visualizationType];
    var newVisualization = new selectedVisualization.visualization();
    panel.cache.visualizations[visualizationType] = newVisualization;
    panel.cache.visualization = panel.cache.visualizations[visualizationType];
    panel.display.settings = panel.cache.visualization.settings;

    // Give the query builder a piece of cache
    panel.cache.query_builder = {
      'validation': {}
    };

    // Flag to toggle bootstrap dropdown menu status
    panel.cache.visualizationDropdownOpen = false;

    // Any changes to the code result in precompute being turned off
    $scope.$watch(function () {
      return panel.data_source.code;
    }, function (newVal, oldVal) {
      if (newVal != oldVal) {
        panel.data_source.precompute.enabled = false;
      }
    });

    // Translate the code toggle switch into a source_type value and vice-versa
    $scope.$watch(function () {
      return panel.data_source.source_type;
    }, function (newVal, oldVal) {
      if (panel.data_source.source_type == 'pycode') {
        panel.cache.query_builder.code = true;
      }
      else {
        panel.cache.query_builder.code = false;
      }
    });
    $scope.$watch(function () {
      return panel.cache.query_builder.code;
    }, function (newVal, oldVal) {
      if (panel.cache.query_builder.code) {
        panel.data_source.source_type = 'pycode';
      }
      else {
        panel.data_source.source_type = 'querybuilder';
      }
    });

    // Automatically format from/to datetime fields
    $scope.$watch(function () {
      return panel.data_source.timeframe.from;
    }, function (newVal, oldVal) {
      panel.data_source.timeframe.from = $scope.formatDateTime(newVal);      
    });
    $scope.$watch(function (newVal, oldVal) {
      return panel.data_source.timeframe.to;
    }, function (newVal, oldVal) {
      panel.data_source.timeframe.to = $scope.formatDateTime(newVal);
    });

    // Update property dropdowns/typeaheads when the stream changes
    $scope.$watch(function () {
      return panel.data_source.query.stream;
    }, function (newVal, oldVal) {
      $scope.updateSchema(panel);
      
      // Validate the existence of a stream selection
      var missingStreamComplaint = 'No stream selected.';
      if (!newVal) {
        makeComplaint(panel.cache.query_builder.validation,
                      missingStreamComplaint);
      }
      else {
        revokeComplaint(panel.cache.query_builder.validation,
                        missingStreamComplaint);
      }
    });

    $scope.$watch(function () {
      return panel.cache.visualization;
    }, function (newVal, oldVal) {
      if (newVal) {
        checkSchema(panel);
      }
    });
  };

  $scope.newPanelObj = function () {
    return {
      id: (Math.floor(Math.random() * 0x100000000)).toString(16),
      title: '',
      data_source: {
        source_type: 'querybuilder',
        display: true,
        refresh_seconds: null,
        autorun: true,
        autorefresh: {
          enabled: false,
          interval: 10 * 60
        },
        code: '',
        query: {
          stream: undefined,
          steps: []
        },
        timeframe: {
          mode: $scope.timeframeModes[0],
          value: 2,
          scale: {name: 'days'},
          from: moment().subtract('days', 2).format($scope.dateTimeFormat),
          to: moment().format($scope.dateTimeFormat)
        },
        precompute: {
          enabled: false,
          task_id: null,
          bucket_width: {
            value: 1,
            scale: {name: 'hours'}
          },
          untrusted_time: {
            value: 30,
            scale: {name: 'minutes'}
          }
        }
      },
      display: {
        display_type: 'table',
        settings: {}
      },
    };
  };

  $scope.addPanel = function() {
    $scope.boardData.panels.unshift($scope.newPanelObj());
    $scope.initPanel($scope.boardData.panels[0]);
    $scope.panelSettingsModal($scope.boardData.panels[0], 0);
  };
  
  $scope.dateTimeFormat = 'MMM DD YYYY HH:mm:ss';

  $scope.formatDateTime = function (datetime) {
    if (typeof datetime == 'string') {
      datetime = moment(new Date(datetime)).format($scope.dateTimeFormat);
    }
    return String(datetime).split(' ').slice(0, 5).join(' ');
  };

  $scope.getBoards = function () {
    BoardService.getBoards().then(function(boards) {
      $scope.boards = boards;
    });
  }

  $scope.getBoards();

  $scope.streams = [''];
  $scope.getStreams = function () {
    $http.get('/streams')
      .success(function(data, status, headers, config) {
        $scope.streams = data.streams;
      });
  }

  $scope.getStreams();

  $scope.modes = [
    {name: 'recent', display: 'Most recent'},
    {name: 'range', display: 'Date range'},
  ];

  $scope.$watch($scope.cleanBoard, function (newVal, oldVal) {
    // The initial setting of boardData doesn't count as a change in my books
    if (typeof newVal == 'undefined' || typeof oldVal == 'undefined') {
      return;
    }
    if (newVal.title != oldVal.title && newVal.title != '') {
      $scope.missingTitle = false;
    }
    if (!$scope.boardHasChanges && newVal != oldVal) {
      $scope.boardHasChanges = true;
    }
  }, true); // Deep watch


  if ($scope.boardId != 'new') {
    $http.get('/board/' + $scope.boardId)
      .success(function(data, status, headers, config) {
        angular.forEach(data.panels, function(panel) {
          $scope.initPanel(panel);
          if (panel.data_source.autorun) {
            $scope.callSource(panel);
          }
        });
        $scope.boardData = data;
      })
      .error(function(data, status, headers, config) {
        if (status == 404) {
          $location.path('/boards/new');
        }
      });
  }
  else {
    $scope.boardData = BoardTransport.getData();
    BoardTransport.reset();
    if ($scope.boardData.panels.length) {
      // If it is coming from a duplication, it needs to be saved.
      $scope.saveBoard();
    }
    else {
      $scope.addPanel();
    }
  }

  var leavingPageText = "Anything not saved will be lost.";

  window.onbeforeunload = function () {
    if ($scope.boardHasChanges){
      return leavingPageText;
    }
  }

  $scope.$on('$destroy', function () {
    window.onbeforeunload = undefined;
  });

  $scope.$on('$locationChangeStart', function(event, next, current) {
    if($scope.boardHasChanges && !$scope.deleting &&
       !confirm(leavingPageText +
                "\n\nAre you sure you want to leave this page?")) {
      event.preventDefault();
    }
  });

  Mousetrap.bindGlobal(['ctrl+s', 'meta+s'], function(e) {
    if (e.preventDefault) {
      e.preventDefault();
    } else {
      // internet explorer
      e.returnValue = false;
    }
    $scope.saveBoard();
  });

  $scope.saveHidden = function () {
    return $scope.boardId == 'new' && !$scope.boardHasChanges;
  };

  $scope.saveDisabled = function () {
    if ($scope.boardId == 'new') {
      return false;
    }
    return !$scope.boardHasChanges;
  };

  $scope.duplicateDeleteHidden = function () {
    return $scope.boardId == 'new';
  };

  ToolbarButtonService.setButtons([
    {
      'title': 'Save',
      'icon': 'ti-save',
      'action': $scope.saveBoard,
      'disabled': $scope.saveDisabled,
      'hidden': $scope.saveHidden
    },
    {
      'title': 'Duplicate',
      'icon': 'ti-files',
      'action': $scope.duplicateBoardModal,
      'hidden': $scope.duplicateDeleteHidden
    },
    {
      'title': 'Delete',
      'icon': 'ti-trash',
      'action': $scope.deleteBoard,
      'hidden': $scope.duplicateDeleteHidden
    }
  ]);
}]);

app.directive('visualization', function ($http, $compile) {
  var linker = function(scope, element, attrs) {
    scope.$watch('module', function () {
      $http.get(['static/app/board/visualizations',
                 scope.module.meta.title,
                 scope.module.meta.template].join('/'))
        .success(function(data, status, headers, config) {
          element.html(data);
          $compile(element.contents())(scope);
        });
    });
  }

  return {
    restrict: "E",
    replace: true,
    link: linker,
    scope: {
      module:'='
    }
  };
});

