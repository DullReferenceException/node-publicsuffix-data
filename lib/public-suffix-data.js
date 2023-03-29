const path = require('path');
const { Readable } = require('stream')
const fs = require('fs').promises;
const fetch = require('node-fetch');
const TLDParseStream = require('./tld-parse-stream');

class PublicSuffixData { 
  constructor(opts) {
    opts = opts || {};

    this._tts = (opts.tts || 864000) * 1000;
    this._ttl = (opts.ttl || 2592000) * 1000;
    this._cachePath = (opts.cache || path.resolve(process.env.USERPROFILE || process.env.HOME, './.publicsuffix.org'));
    this._dataUrl = opts.url || 'https://publicsuffix.org/list/effective_tld_names.dat';

    this._tree = null;
  }

  async getTLD(domain) {
    const segments = domain.toLowerCase().split('.');
    const rootNode = await this._getMemoryCachedTree();
    const tldSegments = [];
    let node = rootNode;
    while (node) {
      const candidate = segments.pop();
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
  }

  _getMemoryCachedTree() {
    const now = Date.now();
    const hasUsableTree = this._tree && this._tree.ttl > now;
    const needsNewTree = !this._tree || this._tree.tts < now;

    let treePromise;
    if (needsNewTree) {
      treePromise = this._getDiskCachedTree();
      if (hasUsableTree) {
        // Swallow unhandled errors
        treePromise = treePromise.catch(() => {});
      }
    }

    return hasUsableTree ? this._tree.object : treePromise;
  }

  async _getDiskCachedTree() {
    let status;
    try {
      const stats = await fs.stat(this._cachePath);
      const delta = Date.now() - stats.mtime.getTime();
      status = {
        isStale: delta > this._tts,
        isInvalid: delta > this._ttl
      };  
    } catch (err) {
      status = { isInvalid: true };
    }

    let internetPromise;
    if (status.isInvalid || status.isStale) {
      internetPromise = this._getTreeFromInternet();
      if (!status.isInvalid) {
        // Swallow errors
        internetPromise = internetPromise.catch(() => {});
      }
    }

    return status.isInvalid ? internetPromise : this._getTreeFromDisk();
  }

  async _getTreeFromDisk() {
    try {
      const content = await fs.readFile(this._cachePath, { encoding: 'utf8' });
      const tree = JSON.parse(content);
      this._cacheTreeInMemory(tree);
      return tree;  
    } catch (err) {
      return this._getTreeFromInternet();
    }
  }

  async _getTreeFromInternet() {
    const res = await fetch(this._dataUrl);
    if (!res.ok) {
      throw new Error(`Received ${res.status} error from ${this._dataUrl}`);
    }

    return new Promise((resolve, reject) => {
      const tree = {};
      Readable.from(res.body)
        .on('error', reject)
        .pipe(new TLDParseStream())
        .on('error', reject)
        .on('data', function (tldSegments) {
          let node = tree, segment;
          while (segment = tldSegments.pop()) {
            node = node[segment] || (node[segment] = {});
          }
        })
        .on('end', () => {
          resolve(tree);

          // Cache data after resolving
          this._cacheTreeInMemory(tree);
          this._cacheTreeOnDisk(tree);
        });
    });
  }

  _cacheTreeInMemory(tree) {
    const now = Date.now();
    this._tree = {
      object: tree,
      tts: now + this._tts,
      ttl: now + this._ttl
    };
  }

  async _cacheTreeOnDisk(tree) {
    try {
      await fs.writeFile(this._cachePath, JSON.stringify(tree));
    } catch (err) {
      // Swallow the error
    }
  }
}

module.exports = PublicSuffixData;
