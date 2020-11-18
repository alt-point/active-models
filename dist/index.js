'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var merge = require('merge');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var merge__default = /*#__PURE__*/_interopDefaultLegacy(merge);

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

var classCallCheck = _classCallCheck;

function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}

function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  return Constructor;
}

var createClass = _createClass;

function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;

  for (var i = 0, arr2 = new Array(len); i < len; i++) {
    arr2[i] = arr[i];
  }

  return arr2;
}

var arrayLikeToArray = _arrayLikeToArray;

function _arrayWithoutHoles(arr) {
  if (Array.isArray(arr)) return arrayLikeToArray(arr);
}

var arrayWithoutHoles = _arrayWithoutHoles;

function _iterableToArray(iter) {
  if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter);
}

var iterableToArray = _iterableToArray;

function _unsupportedIterableToArray(o, minLen) {
  if (!o) return;
  if (typeof o === "string") return arrayLikeToArray(o, minLen);
  var n = Object.prototype.toString.call(o).slice(8, -1);
  if (n === "Object" && o.constructor) n = o.constructor.name;
  if (n === "Map" || n === "Set") return Array.from(o);
  if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return arrayLikeToArray(o, minLen);
}

var unsupportedIterableToArray = _unsupportedIterableToArray;

function _nonIterableSpread() {
  throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}

var nonIterableSpread = _nonIterableSpread;

function _toConsumableArray(arr) {
  return arrayWithoutHoles(arr) || iterableToArray(arr) || unsupportedIterableToArray(arr) || nonIterableSpread();
}

var toConsumableArray = _toConsumableArray;

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

var defineProperty = _defineProperty;

/**
 * String to camel case
 * @param {string} s
 * @returns {string}
 */

var stringToCamelCase = function stringToCamelCase(s) {
  var result = s.split('_').map(function (s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join('');
  return result.charAt(0).toLowerCase() + result.slice(1);
};
/**
 * String to pascal case
 * @param {string} s
 * @returns {string}
 */


var stringToPascalCase = function stringToPascalCase(s) {
  return String(s).split('_').map(function (s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join('');
};
/**
 * sanitize data
 * @param data
 * @returns {any}
 */


var sanitize = function sanitize(data) {
  return merge__default['default'].recursive(true, {}, data);
};
/**
 * Применяем данные переданные в конструктор к модели
 * @param data
 * @param model
 */


var fill = function fill(model, data) {
  for (var prop in data) {
    if (Object.prototype.hasOwnProperty.call(data, prop)) {
      model[prop] = data[prop];
    }
  }
};
/**
 * Set default attributes
 * @param {Object} model
 * @param {Object} $defaultAttributes
 * @param {Array} getters
 * @returns {*}
 */


var setDefaultAttributes = function setDefaultAttributes(model, $defaultAttributes) {
  var getters = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

  for (var prop in $defaultAttributes) {
    if (!Object.prototype.hasOwnProperty.call(model, prop) && Object.prototype.hasOwnProperty.call($defaultAttributes, prop)) {
      model[prop] = model[prop] || $defaultAttributes[prop];
    }
  }

  Object.defineProperties(model, getters.map(function (p) {
    return defineProperty({}, p, {
      enumerable: true
    });
  }));
  return model;
};
/**
 * Поднимаем все свойства и методы из цепочки прототипов
 * @param {Class} constructor
 * @param {array} properties
 * @returns {*[]}
 */


var getStaticMethodsNamesDeep = function getStaticMethodsNamesDeep(constructor) {
  var properties = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

  if (!constructor) {
    return toConsumableArray(new Set(properties));
  }

  var op = Reflect.ownKeys(constructor).filter(function (prop) {
    return typeof prop === 'string';
  }).filter(function (prop) {
    return !['arguments', 'callee', 'caller'].includes(prop);
  }).filter(function (prop) {
    return typeof constructor[prop] === 'function';
  });
  properties.push.apply(properties, toConsumableArray(op));
  return getStaticMethodsNamesDeep(Object.getPrototypeOf(constructor), properties);
};

var requiredCheck = function requiredCheck(model, prop, value) {
  var required = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : [];

  if (required.includes(prop)) {
    if (!Object.prototype.hasOwnProperty.call(model, prop) || value === undefined) {
      throw new Error("Property ".concat(prop, " is required!"));
    }
  }
};

var fillableCheck = function fillableCheck(prop) {
  var fillable = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

  // Если свойство не содержится в массиве доступных для присвоения свойств,
  // то устанавливать его значение запрещено
  if (fillable.length) {
    return fillable.includes(prop);
  }

  return true;
};
/**
 * Proxy getter
 * @param model
 * @param prop
 * @param value
 * @param receiver
 * @returns {boolean}
 */


var setter = function setter(model, prop, value, receiver) {
  if (model[prop] === value) {
    return Reflect.set(model, prop, value, receiver);
  }

  if (!fillableCheck(prop, model.constructor.fillable)) {
    return false;
  } // check required value


  requiredCheck(model, prop, value, model.constructor.required); // validate value

  var pascalProp = stringToPascalCase(prop);
  var validator = typeof prop === 'string' && "validate".concat(pascalProp);

  if (typeof model.constructor[validator] === 'function') {
    model.constructor[validator](model, prop, value);
  }

  var setter = typeof prop === 'string' && "setter".concat(pascalProp);

  if (typeof model.constructor[setter] === 'function') {
    model.constructor[setter](model, prop, value, receiver);
  } else {
    Reflect.set(model, prop, value, receiver);
  }
};
/**
 * Getter
 * @param target
 * @param prop
 * @param receiver
 * @returns {any}
 */


var getter = function getter(target, prop, receiver) {
  // Если свойство скрыто, то вместо его значения возвращаем `undefined`
  if (target.constructor.hidden.includes(prop) && typeof target[prop] !== 'function') {
    return;
  }

  var pascalProp = stringToPascalCase(prop);
  var getter = typeof prop === 'string' && "getter".concat(pascalProp);

  if (typeof target[prop] === 'function') {
    return Reflect.get(target, prop, receiver);
  }

  if (typeof target.constructor[getter] === 'function') {
    return target.constructor[getter](target, prop, receiver);
  } else {
    return Reflect.get(target, prop, receiver);
  }
};
/**
 * Active record model
 * @param {object} data
 * @param {object} $attributes
 */


var ActiveModel = /*#__PURE__*/function () {
  createClass(ActiveModel, [{
    key: "toString",
    value: function toString() {
      return JSON.stringify(this);
    }
  }, {
    key: "makeFreeze",
    value: function makeFreeze() {
      return Object.freeze(this);
    }
    /**
     * Модель
     * @param {object} data
     * @returns {Proxy<ActiveModel>|{}}
     */

  }], [{
    key: "$attributes",
    get: function get() {
      return {};
    }
    /**
     * Список полей, доступных для явного изменения
     * @return {*[]}
     */

  }, {
    key: "fillable",
    get: function get() {
      return [];
    }
    /**
     * Список обязательных полей
     * @return {*[]}
     */

  }, {
    key: "required",
    get: function get() {
      return [];
    }
    /**
     * Список полей, недоступных для чтения, например `password`
     * @returns {Array}
     */

  }, {
    key: "hidden",
    get: function get() {
      return [];
    }
  }]);

  function ActiveModel() {
    var data = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    classCallCheck(this, ActiveModel);

    var self = this;
    var handler = {
      get: function get(target, prop, receiver) {
        return getter(target, prop, receiver);
      },
      set: function set(target, prop, value, receiver) {
        setter(target, prop, value, receiver);
        return true;
      },
      apply: function apply(target, thisArg, argumentsList) {
        return Reflect.apply(target, thisArg, argumentsList);
      },
      getPrototypeOf: function getPrototypeOf() {
        return Reflect.getPrototypeOf(self);
      },
      deleteProperty: function deleteProperty(target, prop) {
        return Reflect.deleteProperty(target, prop);
      },
      has: function has(target, prop) {
        return Reflect.has(target, prop);
      }
    };
    var getters = getStaticMethodsNamesDeep(this.constructor).filter(function (fn) {
      return fn.startsWith('getter');
    }).map(function (fn) {
      return stringToCamelCase(fn.substring(6));
    });

    if (getters.length) {
      handler.ownKeys = function (target) {
        return toConsumableArray(new Set(Reflect.ownKeys(target).concat(getters)));
      };
    }

    data = setDefaultAttributes(sanitize(data || {}), this.constructor.$attributes, getters);
    var model = new Proxy(this, handler);
    fill(model, data);
    return model;
  }

  return ActiveModel;
}();

function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

var setPrototypeOf = createCommonjsModule(function (module) {
function _setPrototypeOf(o, p) {
  module.exports = _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) {
    o.__proto__ = p;
    return o;
  };

  return _setPrototypeOf(o, p);
}

module.exports = _setPrototypeOf;
});

function _isNativeReflectConstruct() {
  if (typeof Reflect === "undefined" || !Reflect.construct) return false;
  if (Reflect.construct.sham) return false;
  if (typeof Proxy === "function") return true;

  try {
    Date.prototype.toString.call(Reflect.construct(Date, [], function () {}));
    return true;
  } catch (e) {
    return false;
  }
}

var isNativeReflectConstruct = _isNativeReflectConstruct;

var construct = createCommonjsModule(function (module) {
function _construct(Parent, args, Class) {
  if (isNativeReflectConstruct()) {
    module.exports = _construct = Reflect.construct;
  } else {
    module.exports = _construct = function _construct(Parent, args, Class) {
      var a = [null];
      a.push.apply(a, args);
      var Constructor = Function.bind.apply(Parent, a);
      var instance = new Constructor();
      if (Class) setPrototypeOf(instance, Class.prototype);
      return instance;
    };
  }

  return _construct.apply(null, arguments);
}

module.exports = _construct;
});

function _createForOfIteratorHelper(o, allowArrayLike) { var it; if (typeof Symbol === "undefined" || o[Symbol.iterator] == null) { if (Array.isArray(o) || (it = _unsupportedIterableToArray$1(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = o[Symbol.iterator](); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }

function _unsupportedIterableToArray$1(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray$1(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray$1(o, minLen); }

function _arrayLikeToArray$1(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }

var Enum = /*#__PURE__*/function () {
  /**
   * @param entries
   * @param defaultValue
   */
  function Enum() {
    var entries = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
    var defaultValue = arguments.length > 1 ? arguments[1] : undefined;

    classCallCheck(this, Enum);

    defineProperty(this, "__map", new Map());

    defineProperty(this, "__default", undefined);

    var _iterator = _createForOfIteratorHelper(entries),
        _step;

    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var key = _step.value;

        this.__map.set(key, key);
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }

    this.__default = defaultValue;
  }

  createClass(Enum, [{
    key: "values",
    value: function values() {
      return construct(Array, toConsumableArray(this.__map.values()));
    }
  }, {
    key: "get",
    value: function get(key) {
      return this.__map.get(key);
    }
  }, {
    key: "set",
    value: function set(key, value) {
      return this.__map.set(key, value);
    }
  }, {
    key: "has",
    value: function has(key) {
      return this.__map.has(key);
    }
    /**
     * Валидация установленного значения
     * @param value
     * @return {boolean}
     */

  }, {
    key: "validate",
    value: function validate(value) {
      if (!this.has(value)) {
        throw new Error("Value must be include one of type: ".concat(this.values().join(', '), "; Provide value \"").concat(value, "\""));
      }

      return true;
    }
  }, {
    key: "default",
    get: function get() {
      return this.__default;
    }
  }]);

  return Enum;
}();

function _assertThisInitialized(self) {
  if (self === void 0) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }

  return self;
}

var assertThisInitialized = _assertThisInitialized;

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function");
  }

  subClass.prototype = Object.create(superClass && superClass.prototype, {
    constructor: {
      value: subClass,
      writable: true,
      configurable: true
    }
  });
  if (superClass) setPrototypeOf(subClass, superClass);
}

var inherits = _inherits;

var _typeof_1 = createCommonjsModule(function (module) {
function _typeof(obj) {
  "@babel/helpers - typeof";

  if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
    module.exports = _typeof = function _typeof(obj) {
      return typeof obj;
    };
  } else {
    module.exports = _typeof = function _typeof(obj) {
      return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
    };
  }

  return _typeof(obj);
}

module.exports = _typeof;
});

function _possibleConstructorReturn(self, call) {
  if (call && (_typeof_1(call) === "object" || typeof call === "function")) {
    return call;
  }

  return assertThisInitialized(self);
}

var possibleConstructorReturn = _possibleConstructorReturn;

var getPrototypeOf = createCommonjsModule(function (module) {
function _getPrototypeOf(o) {
  module.exports = _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) {
    return o.__proto__ || Object.getPrototypeOf(o);
  };
  return _getPrototypeOf(o);
}

module.exports = _getPrototypeOf;
});

function _isNativeFunction(fn) {
  return Function.toString.call(fn).indexOf("[native code]") !== -1;
}

var isNativeFunction = _isNativeFunction;

var wrapNativeSuper = createCommonjsModule(function (module) {
function _wrapNativeSuper(Class) {
  var _cache = typeof Map === "function" ? new Map() : undefined;

  module.exports = _wrapNativeSuper = function _wrapNativeSuper(Class) {
    if (Class === null || !isNativeFunction(Class)) return Class;

    if (typeof Class !== "function") {
      throw new TypeError("Super expression must either be null or a function");
    }

    if (typeof _cache !== "undefined") {
      if (_cache.has(Class)) return _cache.get(Class);

      _cache.set(Class, Wrapper);
    }

    function Wrapper() {
      return construct(Class, arguments, getPrototypeOf(this).constructor);
    }

    Wrapper.prototype = Object.create(Class.prototype, {
      constructor: {
        value: Wrapper,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
    return setPrototypeOf(Wrapper, Class);
  };

  return _wrapNativeSuper(Class);
}

module.exports = _wrapNativeSuper;
});

function _createSuper(Derived) { var hasNativeReflectConstruct = _isNativeReflectConstruct$1(); return function _createSuperInternal() { var Super = getPrototypeOf(Derived), result; if (hasNativeReflectConstruct) { var NewTarget = getPrototypeOf(this).constructor; result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return possibleConstructorReturn(this, result); }; }

function _isNativeReflectConstruct$1() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Date.prototype.toString.call(Reflect.construct(Date, [], function () {})); return true; } catch (e) { return false; } }

var Callable = /*#__PURE__*/function (_Function) {
  inherits(Callable, _Function);

  var _super = _createSuper(Callable);

  function Callable() {
    var _this;

    classCallCheck(this, Callable);

    _this = _super.call(this);
    return possibleConstructorReturn(_this, new Proxy(assertThisInitialized(_this), {
      apply: function apply(target, thisArg, args) {
        return target.__call.apply(target, toConsumableArray(args));
      }
    }));
  }

  return Callable;
}( /*#__PURE__*/wrapNativeSuper(Function));

exports.ActiveModel = ActiveModel;
exports.CallableModel = Callable;
exports.Enum = Enum;
//# sourceMappingURL=index.js.map
