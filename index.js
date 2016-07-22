'use strict';

//    # Deco 2

const Assign = require('copy-properties/assign');
const Bursary = require('bursary');
const CallerPath = require('caller-path');
const Copy = require('copy-properties/copy');
const Fs = require('fs');
const Path = require('path');

//    ## Utility Functions
// Check if the given value is a function.
const isFunction = (a) => typeof a === 'function';

// Calculate the prototype chain of a given prototype.
const chain = (prototype) => {
  if (!prototype) return [];
  return [ prototype, ...chain(Reflect.getPrototypeOf(prototype)) ];
};
// Copy all methods from a given prototype's chain into one object.
const flatten = (prototype) => Copy(...chain(prototype).reverse());
// Check if the given value is a class.
const isClass = (a) => {
  if (!isFunction(a)) return false;
  if (!Reflect.ownKeys(a).includes('prototype')) return false;
  if (a.toString().indexOf('class') !== 0) return false;
  return true;
};
// constructors stores the initialization methods for each factory
//   function created with Deco.
// defaults stores the defaults associated with a Deco factory.
const secrets = Bursary({
  constructors: Array,
  defaults: Object
});
// Set `prototype` property and the actual prototype for the given object.
const setPrototype = (o, prototype) => {
  o.prototype = prototype;
  Reflect.setPrototypeOf(o, prototype);
};
// Symbols used internally.
const symbols = {
  isClassWrapper: Symbol('isClassWrapper')
};

//    ## Factory Private Static Members
// Constructors that will be applied sequentially to newly created instances.
const concatenateConstructors = (factory, ...decorators) => {
  const constructors = secrets(factory).constructors;
  constructors.push(...decorators.map((decorator) => {
    if (Reflect.hasOwnProperty.call(decorator, 'constructor')) {
      return decorator.constructor;
    }
    if (isFunction(decorator) && !isClass(decorator)) {
      if (!decorator.prototype) return decorator;
      return decorator.prototype.constructor;
    }
    if (isClass(decorator)) {
      const ƒ = (...parameters) => Reflect.construct(decorator, parameters);
      ƒ[symbols.isClassWrapper] = true;
      return ƒ;
    }
    return undefined;
  }).filter((a) => a));
};
//
const concatenateDefaults = (factory, ...decorators) => {
  Assign(secrets(factory).defaults, ...decorators.map((decorator) => {
    if (Reflect.hasOwnProperty.call(decorator, 'defaults')) {
      return decorator.defaults;
    }
    return undefined;
  }));
};
//
const concatenatePrototypes = (factory, ...decorators) => {
  Assign(factory.prototype, ...decorators.map((decorator) =>
    isFunction(decorator) ? flatten(decorator.prototype) : decorator));
};
// Use assignment based inheritence to mix in members from objects, vanilla
// JavaScript constructors, and/or Deco decorators.
const concatenate = (factory, ...decorators) => {
  concatenateConstructors(factory, ...decorators);
  concatenateDefaults(factory, ...decorators);
  concatenatePrototypes(factory, ...decorators);
};
// Create and assign the constructor to the given factory prototype.
const initialize = (factory) => {
  const members = {
    constructor: function factoryConstructor (...parameters) {
      /* eslint-disable no-invalid-this */
      const constructors = secrets(factory).constructors;

      // Apply each merged constructor function, one after the other.
      return constructors.reduce((o, ƒ) => {
        const next = ƒ.apply(o, parameters);
        if (next === undefined) return o;
        if (next === o) return o;
        Assign(next, factory.prototype);
        return next;
      }, this);
      /* eslint-enable no-invalid-this */
    },
    defaults (...updates) {
      return Copy(secrets(factory).defaults, ...updates);
    }
  };

  /* eslint-disable no-use-before-define */
  const statics = {
    defaults (...updates) {
      return Deco(this, {
        defaults: Copy(secrets(this).defaults, ...updates)
      });
    }
  };
  /* eslint-enable no-use-before-define */

  for (const name of Reflect.ownKeys(members)) {
    Reflect.defineProperty(factory.prototype, name, {
      configurable: true,
      enumerable: false,
      value: members[name],
      writable: true
    });
  }

  for (const name of Reflect.ownKeys(statics)) {
    Reflect.defineProperty(factory, name, {
      configurable: true,
      enumerable: false,
      value: statics[name],
      writable: true
    });
  }
};

//    ## Module Definition
//
//    A function used to create factory functions (*classes*) by mixing in any
//    number of objects and/or vanilla JavaScript classes.  Deco factories
//    themselves can be passed in as a decorator to another call to `Deco()`.

const Deco = module.exports = function Deco (...decorators) {
  // A factory function for creating new instances of the "class."
  const factory = function factory (...parameters) {
    /* eslint-disable no-invalid-this */
    const ƒ = factory.prototype.constructor;

    const create = () => Reflect.construct(ƒ, parameters, factory);

    // When called as e.g. `Factory()`.
    if (!this) return create();

    // If the factory was called from a containing object, also create
    // the object e.g. when called as `YourLibrary.Factory()`.
    for (const key of Reflect.ownKeys(this)) {
      if (this[key] === factory) return create();
    }

    // If the decorator is called directly, e.g. `Factory.call(o)`, assign the
    // prototype properties and run the object through the constructor chain
    // manually.
    Assign(this, factory.prototype);
    return ƒ.apply(this, parameters);
    /* eslint-enable no-invalid-this */
  };

  // Set up the factory prototype, statics, and constructor,
  // then apply the given decorators.
  setPrototype(factory, Object.create(Deco.prototype));
  initialize(factory);
  concatenate(factory, ...decorators);

  Object.freeze(factory);
  Object.freeze(factory.prototype);

  return factory;
};

// Set up Deco's prototype.  The factory will cause most created objects
// to inherit from Deco.
setPrototype(Deco, Object.create(Function.prototype));

//    ## Deco Public Methods
// Apply defaults to options.
Deco.copy = (options, ...updates) => Copy(options, ...updates);
// Allow a way for instances to store private data.
Deco.hidden = (definition) => Bursary(definition);
// Load and apply decorators from the caller's directory.
Deco.load = (...files) => {
  const directory = Path.dirname(CallerPath());
  return Deco.loadFrom(directory, ...files);
};
// Load and apply decorators from a directory.
Deco.loadFrom = (directory, ...files) => {
  const factory = Deco(...Deco.requireFrom(directory, ...files));
  return factory;
};
// Require all files in the caller's directory.
Deco.require = (...files) => {
  const directory = Path.dirname(CallerPath());
  return Deco.requireFrom(directory, ...files);
};
// Require a directory, optionally specify names/order of the files
//  to be loaded.
Deco.requireFrom = (directory, ...files) => {
  /* eslint-disable global-require */
  if (!files.length) files.push(...Fs.readdirSync(directory));
  const notIndex = files.filter((file) => {
    if (file === 'index.js') return false;
    if (file === 'index.json') return false;
    if (file === 'index.node') return false;
    return true;
  });
  return notIndex.map((file) => require(Path.resolve(directory, file)));
  /* eslint-enable global-require */
};

Object.freeze(Deco);
Object.freeze(Deco.prototype);
