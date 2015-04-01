var proxyquire = require('proxyquire');
var sinon = require('sinon');
var chai = require('chai');
var expect = chai.expect;
chai.use(require('sinon-chai'));

var EventEmitter = require('events').EventEmitter;
var PassThroughStream = require('stream').PassThrough;

describe('getTLD', function () {
  beforeEach(setup);

  var PublicSuffixData;
  var fs, request;

  it('defaults the cache file location to USERPROFILE if that variable exists', function () {
    process.env.USERPROFILE = 'userProfilePath';
    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(fs.stat).to.have.been.calledWithMatch(sinon.match(function (path) {
          return path.indexOf('userProfilePath') >= 0;
        }));
      });
  });

  it('defaults the cache file location to HOME if that variable exists', function () {
    delete process.env.USERPROFILE;
    process.env.HOME = 'userHomeDir';

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(fs.stat).to.have.been.calledWithMatch(sinon.match(function (path) {
          return path.indexOf('userHomeDir') >= 0;
        }));
      });
  });

  it('retrieves the list from the Internet if the cached file does not exist', function () {
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields({ code: 'ENOENT' });

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.been.calledWith('https://publicsuffix.org/list/effective_tld_names.dat');
      });
  });

  it('yields an error if there is no cached data and data retrieval fails', function (done) {
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields({ code: 'ENOENT' });
    request.returns(createMockErrorStream());

    var data = new PublicSuffixData();
    data.getTLD('somedomain.com')
      .catch(function (err) {
        expect(err).to.exist;
        done();
      });
  });

  it('retrieves the list from the Internet if the cached file exceeds the time-to-stale setting', function () {
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields(null, { mtime: new Date(Date.now() - 1296000000) });

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.been.calledWith('https://publicsuffix.org/list/effective_tld_names.dat');
      });
  });

  it('does not yield an error if there is stale but not expired cached data and data retrieval fails', function () {
    request.returns(createMockErrorStream());
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields(null, { mtime: new Date(Date.now() - 150000) });

    var data = new PublicSuffixData({ tts: 100, ttl: 200 });
    return data.getTLD('somedomain.com')
      .catch(function (err) {
        expect(err).to.not.exist;
      });
  });

  it('yields an error if there is expired cached data and data retrieval fails', function (done) {
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields(null, { mtime: new Date(Date.now() - 300000) });
    request.returns(createMockErrorStream());

    var data = new PublicSuffixData({ tts: 100, ttl: 200 });
    data.getTLD('somedomain.com')
      .catch(function (err) {
        expect(err).to.exist;
        done();
      });
  });

  it('does not retrieve the list from the Internet if there is a non-stale cached file', function () {
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields(null, { mtime: new Date() });

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.not.been.called;
      });
  });

  it('retrieves the list from the Internet if there is a non-stale cached file that gets a read error', function () {
    fs.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).yields(null, { mtime: new Date() });
    fs.readFile.yields(new Error());

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.been.called;
      });
  });

  it('saves the retrieved list to the cache location', function () {
    var cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.stat.withArgs(cacheFile).yields({ code: 'ENOENT' });

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .delay(1) // Cache is written after the data is returned
      .then(function () {
        expect(fs.writeFile).to.have.been.calledWithMatch(cacheFile);
      });
  });

  it('caches the TLDs to memory so subsequent disk reads or Internet fetches are not needed', function () {
    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        fs.stat.reset();
        return data.getTLD('somethingelse.net');
      })
      .then(function () {
        expect(fs.stat).to.have.not.been.called;
      })
  });

  it('returns data from memory when valid but stale, so fetch is performed out-of-band', function () {
    this.timeout(5000);

    fs.stat.yields({ code: 'ENOENT' });
    request.returns(createMockStream('uk'));

    var data = new PublicSuffixData({ tts: 1, ttl: 1000000 });
    return data.getTLD('somedomain.co.uk')
      .then(function (tld) {
        expect(tld).to.equal('uk');
      })
      .delay(2000)
      .then(function () {
        request.returns(createMockStream('uk\nco.uk'));
        return data.getTLD('somedomain.co.uk');
      })
      .then(function (tld) {
        expect(tld).to.equal('uk'); // We still serve up stale data
      })
      .delay(1000)
      .then(function () {
        return data.getTLD('somedomain.co.uk');
      })
      .then(function (tld) {
        expect(tld).to.equal('co.uk');
      })
  });

  it('handles single-segment TLDs', function () {
    var cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.stat.withArgs(cacheFile).yields({ code: 'ENOENT' });
    request.returns(createMockStream('com'));

    var data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function (tld) {
        expect(tld).to.equal('com');
      });
  });

  it('handles two-segment TLDs', function () {
    var cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.stat.withArgs(cacheFile).yields({ code: 'ENOENT' });
    request.returns(createMockStream('co\nuk\nco.uk'));

    var data = new PublicSuffixData();
    return data.getTLD('foo.co.uk')
      .then(function (tld) {
        expect(tld).to.equal('co.uk');
      });
  });

  it('handles exception rules', function () {
    var cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.stat.withArgs(cacheFile).yields({ code: 'ENOENT' });
    request.returns(createMockStream('*.kawasaki.jp\n!city.kawasaki.jp'));

    var data = new PublicSuffixData();
    return data.getTLD('city.kawasaki.jp')
      .then(function (tld) {
        expect(tld).to.equal('kawasaki.jp');
      });
  });

  it('ignores comments', function () {
    var cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.stat.withArgs(cacheFile).yields({ code: 'ENOENT' });
    request.returns(createMockStream('jp\n// jp geographic type names\n*.kawasaki.jp'));

    var data = new PublicSuffixData();
    return data.getTLD('foo.kawasaki.jp')
      .then(function (tld) {
        expect(tld).to.equal('foo.kawasaki.jp');
      });
  });

  function setup() {
    fs = {
      stat: sinon.stub().yields(null, { mtime: new Date() }),
      readFile: sinon.stub().yields(null, '{}'),
      writeFile: sinon.stub().yields()
    };

    request = sinon.stub().returns(createMockStream(''));

    PublicSuffixData = proxyquire('../../libs/public-suffix-data', {
      fs: fs,
      request: request
    });
  }

  function createMockStream(content) {
    var stream = new PassThroughStream();
    stream.end(content);
    return stream;
  }

  function createMockErrorStream() {
    var mockStream = new EventEmitter();
    mockStream.on = sinon.stub().withArgs('error').yields({ an: 'error' });
    mockStream.pipe = function (writable) { return writable; };
    return mockStream;
  }
});
