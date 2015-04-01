module.exports = PublicSuffixData;

var Promise = require('bluebird');
var path = require('path');
var fs = Promise.promisifyAll(require('fs'));
var request = require('request');
var TLDParseStream = require('./tld-parse-stream');

function PublicSuffixData(opts) {
  opts = opts || {};

  this._tts = (opts.tts || 864000) * 1000;
  this._ttl = (opts.ttl || 2592000) * 1000;
  this._cachePath = (opts.cache || path.resolve(process.env.USERPROFILE || process.env.HOME, './.publicsuffix.org'));
  this._dataUrl = opts.url || 'https://publicsuffix.org/list/effective_tld_names.dat';

  this._tree = null;
}

PublicSuffixData.prototype.getTLD = function (domain, cb) {
  var segments = domain.toLowerCase().split('.');
  return this._getMemoryCachedTree()
    .then(function (rootNode) {
      var tldSegments = [];
      var node = rootNode;
      while (node) {
        var candidate = segments.pop();
        if (candidate in node) {
          tldSegments.unshift(candidate);
          node = node[candidate];
        } else if (('!' + candidate) in node) {
          // Exclusion rule
          break;
        } else if ('*' in node) {
          tldSegments.unshift(candidate);
          node = node['*'];
        } else {
          break;
        }
      }
      return tldSegments.join('.');
    })
    .nodeify(cb);
};

PublicSuffixData.prototype._getMemoryCachedTree = function () {
  var now = Date.now();
  var hasUsableTree = this._tree && this._tree.ttl > now;
  var needsNewTree = !this._tree || this._tree.tts < now;

  var treePromise;
  if (needsNewTree) {
    treePromise = this._getDiskCachedTree();
    if (hasUsableTree) {
      // Swallow unhandled errors
      treePromise = treePromise.done();
    }
  }

  return hasUsableTree ? Promise.resolve(this._tree.object) : treePromise;
};

PublicSuffixData.prototype._getDiskCachedTree = function () {
  return fs.statAsync(this._cachePath)
    .bind(this)
    .then(function (stats) {
      var delta = Date.now() - stats.mtime.getTime();
      return {
        isStale: delta > this._tts,
        isInvalid: delta > this._ttl
      };
    })
    .catch(function () {
      return { isInvalid: true };
    })
    .then(function (status) {
      var internetPromise;
      if (status.isInvalid || status.isStale) {
        internetPromise = this._getTreeFromInternet();
        if (!status.isInvalid) {
          // Swallow errors
          internetPromise = internetPromise.done();
        }
      }
      return status.isInvalid ? internetPromise : this._getTreeFromDisk();
    });
};

PublicSuffixData.prototype._getTreeFromDisk = function () {
  return fs.readFileAsync(this._cachePath, { encoding: 'utf8' })
    .bind(this)
    .then(function (content) {
      var tree = JSON.parse(content);
      this._cacheTreeInMemory(tree);
      return tree;
    })
    .catch(function (err) {
      // We'll swallow the error and fetch from the Internet instead
      return this._getTreeFromInternet();
    });
};

PublicSuffixData.prototype._getTreeFromInternet = function () {
  return new Promise(function (resolve, reject) {
    var tree = {};
    request(this._dataUrl)
      .on('error', reject)
      .pipe(new TLDParseStream())
      .on('error', reject)
      .on('data', function (tldSegments) {
        var node = tree, segment;
        while (segment = tldSegments.pop()) {
          node = node[segment] || (node[segment] = {});
        }
      })
      .on('end', function () {
        resolve(tree);

        // Cache data after resolving
        this._cacheTreeInMemory(tree);
        this._cacheTreeOnDisk(tree);
      }.bind(this));
  }.bind(this));
};

PublicSuffixData.prototype._cacheTreeInMemory = function (tree) {
  var now = Date.now();
  this._tree = {
    object: tree,
    tts: now + this._tts,
    ttl: now + this._ttl
  };
};

PublicSuffixData.prototype._cacheTreeOnDisk = function (tree) {
  fs.writeFileAsync(this._cachePath, JSON.stringify(tree)).done();  // Swallow the error
};
