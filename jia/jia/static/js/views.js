// Helper for re-rendering sub-views.
Backbone.View.prototype.assign = function (selector, view) {
  var selectors;
  if (_.isObject(selector)) {
    selectors = selector;
  } else {
    selectors = {};
    selectors[selector] = view;
  }
  if (!selectors) return;
  _.each(selectors, function (view, selector) {
    view.setElement(this.$(selector)).render();
  }, this);
};

var ErrorAlertView = Backbone.View.extend({
  tagName: 'div',
  className: 'error-alert',
  template: Handlebars.compile(
    '<button type="button" class="close">×</button> \
     <h4>{{ title }}</h4> \
     <p class="error-desc monospace">{{ error.name }}: {{ error.message }}</p> \
     <pre>{{#error.traceback}}{{.}}{{/error.traceback}}</pre>'
  ),
  events: {
    'click .close': 'hide'
  },

  initialize: function(options) {
    this.listenTo(this.model, 'change:error', this.onChange);
    this.title = options.title || 'Oh snap! There was an error!';
  },

  onChange: function() {
    if (this.model.get('error')) {
      this.$el.html(this.template({title: this.title,
                                   error: this.model.get('error') || {}}));
      this.$el.fadeIn();
    } else {
      this.$el.fadeOut();
    }
  },

  hide: function(event) {
    this.model.unset('error');
  },

  render: function() {
    this.$el.hide();
    this.$el.addClass('alert alert-block alert-danger alert-square');
    this.onChange();
  }
});

var TimeSeriesView = Backbone.View.extend({
  tagName: 'div',
  className: 'timeseries',

  initialize: function(options) {
    this.listenTo(this.model, 'change:events', this.render);
    this.listenTo(this.model.get('events'), 'add remove reset', this.render);

    this.yLines = options.yLines || [{name: 'value', key: '@value'}];
    this.series = {};

    // Initialize all series arrays.
    _.each(this.yLines, function(yLine) {
      this.series[yLine.name] = [];
    }, this);

  },

  renderGraph: function() {
    // Reset all series arrays.
    _.each(this.yLines, function(yLine) {
      this.series[yLine.name].length = 0;
    }, this);

    this.model.get('events').forEach(function(event) {
      var x = event.get('@time').toSeconds();
      _.each(this.yLines, function(yLine) {
        this.series[yLine.name].push({x: x, y: event.get(yLine.key) || 0});
      }, this);
    }, this);

    if (this._graph) {
      this._graph.update();
      return;
    }
    
    this.$el.empty();

    var graph = new Rickshaw.Graph({
      element: this.el,
      interpolation: 'linear',
      renderer: 'line',
      series: _.map(this.yLines, function(yLine) {
        if (!this.series[yLine.name].length) {
          this.series[yLine.name].push({x: 0, y: 0});
        }
        return {
          data: this.series[yLine.name],
          color: 'steelblue',
          name: yLine.name
        };
      }, this)
    });
    graph.render();
    this._graph = graph;

    var hoverDetail = new Rickshaw.Graph.HoverDetail({
      graph: graph
    });

    var xAxis = new Rickshaw.Graph.Axis.Time({
      graph: graph
    });
    xAxis.render();
  
    var yAxis = new Rickshaw.Graph.Axis.Y({
      graph: graph,
      orientation: 'right',
      tickFormat: Rickshaw.Fixtures.Number.formatKMBT
    });
    yAxis.render();
  },

  render: function() {
    this.renderGraph();
    return this;
  }
});

var PyCodeView = Backbone.View.extend({
  tagName: 'div',
  className: 'pycode',
  template: ('<div class="timeseries"></div> \
              <div class="code-box"> \
                <div class="code-controls"> \
                  <button type="button" class="btn btn-success run-btn"> \
                    <span class="glyphicon glyphicon-play"></span> Run \
                  </button> \
                  <div class="input-group refresh-ctl"> \
                    <span class="input-group-addon"> \
                      <div class="checkbox"> \
                        <input type="checkbox" id="refresh-chkbox"> \
                      </div> \
                    </span> \
                    <input type="text" class="form-control" id="refresh-val"> \
                  </div> \
                  <div class="msg"> \
                    <span class="label"></span> \
                    <img class="loading" src="/static/img/loading.gif"> \
                  </div> \
                </div> \
                <div class="error-alert"> \
                </div> \
                <textarea id="code"></textarea> \
              </div>'),
  events: {
    'click .run-btn': 'onRun',
    'click #refresh-chkbox': 'setRefreshSeconds',
    'keyup #refresh-val': 'setRefreshSeconds'
  },

  initialize: function(options) {
    this.timeSeriesView = new TimeSeriesView({model: this.model});
    this.errorAlertView = new ErrorAlertView({model: this.model});
  },

  setRefreshSeconds: function(event) {
    var self = this;

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    var refreshSeconds = Math.round(Number(this.$('#refresh-val').val()));
    if (isNaN(refreshSeconds)) {
      this.model.unset('refresh_seconds');
      this.$('.refresh-ctl').addClass('has-error');
      return;
    }

    this.$('.refresh-ctl').removeClass('has-error');
    if (this._refreshCheckBox.prop('checked')) {
      this.model.set('refresh_seconds', refreshSeconds);
      this.refreshInterval = setInterval(function() {
        self.onRun();
      }, refreshSeconds * 1000);
    }
  },

  onRun: function() {
    var self = this;
    var startTime = new Date();
    var delta = null;
    this.$('.run-btn').attr('disabled', 'disabled');
    self.$('.code-controls .msg .label').hide();
    self.$('.code-controls .msg .loading').show();
    this.model.save()
      .always(function() {
        delta = ((new Date()).getTime() - startTime.getTime()) / 1000;
        self.$('.code-controls .msg .loading').hide();
        self.$('.run-btn').removeAttr('disabled');
      })
      .fail(function(jqXHR) {
        self.$('.code-controls .msg .label').removeClass('label-success');
        self.$('.code-controls .msg .label').addClass('label-danger');
        self.$('.code-controls .msg .label').text(delta + 's');
        self.$('.code-controls .msg .label').show();
        self.model.set('error', jqXHR.responseJSON.data);
      })
      .success(function() {
        self.$('.code-controls .msg .label').removeClass('label-danger');
        self.$('.code-controls .msg .label').addClass('label-success');
        self.$('.code-controls .msg .label').text(delta + 's');
        self.$('.code-controls .msg .label').show();
        self.model.unset('error');
      });
  },

  renderCodeMirror: function() {
    var self = this;
    var pyCodeMirror = CodeMirror.fromTextArea(this.$('#code')[0],
                                               {mode: 'python',
                                                lineWrapping: true,
                                                lineNumbers: true,
                                                theme: 'mdn-like'});
    pyCodeMirror.getDoc().setValue(this.model.get('code') || '');
    pyCodeMirror.on('change', function(pyCodeMirror) {
      self.model.set('code', pyCodeMirror.getValue());      
    });
    this._pyCodeMirror = pyCodeMirror;
  },

  renderControls: function() {
    var self = this;
    var refreshCheckBox = this.$('.checkbox input').iCheck({
      checkboxClass: 'icheckbox_flat',
      increaseArea: '20%'
    });
    
    if (this.model.get('refresh_seconds')) {
      this.$('#refresh-val').val(this.model.get('refresh_seconds'));
    }

    refreshCheckBox.on('ifChanged', function(event) {
      self.setRefresh(event);
    });
    this._refreshCheckBox = refreshCheckBox;
  },

  render: function() {
    this.$el.html(this.template);
    this.renderControls();
    this.renderCodeMirror();
    this.assign('.timeseries', this.timeSeriesView);
    this.assign('.error-alert', this.errorAlertView);
    return this;
  }
});

var BoardView = Backbone.View.extend({
  tagName: 'div',
  className: 'board',
  template: '<div class="pycode"></div>',

  initialize: function(options) {
    this.pyCodeView = new PyCodeView({model: this.model.get('pycode')});
  },

  render: function() {
    this.$el.html(this.template);
    this.assign('.pycode', this.pyCodeView);
    return this;
  }
});

var Jia = function() {
  var self = this;

  this.run = function() {
    var model = new Board({id: location.pathname.substring(1)});
    model.fetch({
      success: function() {
        self.boardView = new BoardView({model: model, el: $('.board')});
        self.boardView.render();
      }
    });
  };
};

jia = new Jia();
jia.run();