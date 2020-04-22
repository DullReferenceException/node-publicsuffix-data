const proxyquire = require('proxyquire');
const sinon = require('sinon');
const chai = require('chai');
const { EventEmitter } = require('events');
const { PassThrough: PassThroughStream } = require('stream');

chai.use(require('sinon-chai'));
const expect = chai.expect;

describe('getTLD', function () {
  this.timeout(5000);

  beforeEach(setup);

  let PublicSuffixData;
  let fs, request;

  it('defaults the cache file location to USERPROFILE if that variable exists', async function () {
    process.env.USERPROFILE = 'userProfilePath';
    const data = new PublicSuffixData();

    await data.getTLD('somedomain.com');

    expect(fs.promises.stat).to.have.been.calledWithMatch(sinon.match(function (path) {
      return path.indexOf('userProfilePath') >= 0;
    }));
  });

  it('defaults the cache file location to HOME if that variable exists', function () {
    delete process.env.USERPROFILE;
    process.env.HOME = 'userHomeDir';

    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(fs.promises.stat).to.have.been.calledWithMatch(sinon.match(function (path) {
          return path.indexOf('userHomeDir') >= 0;
        }));
      });
  });

  it('retrieves the list from the Internet if the cached file does not exist', function () {
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).rejects({ code: 'ENOENT' });

    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.been.calledWith('https://publicsuffix.org/list/effective_tld_names.dat');
      });
  });

  it('yields an error if there is no cached data and data retrieval fails', async function () {
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).rejects({ code: 'ENOENT' });
    request.returns(createMockErrorStream());

    const data = new PublicSuffixData();

    let caughtError;
    try {
      await data.getTLD('somedomain.com');
    } catch (err) {
      caughtError = err;
    }
    
    expect(caughtError).to.exist;
  });

  it('retrieves the list from the Internet if the cached file exceeds the time-to-stale setting', function () {
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).resolves({ mtime: new Date(Date.now() - 1296000000) });

    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.been.calledWith('https://publicsuffix.org/list/effective_tld_names.dat');
      });
  });

  it('does not yield an error if there is stale but not expired cached data in memory and data retrieval fails', async function () {
    const data = new PublicSuffixData({ tts: 0.005, ttl: 1 });
    await data.getTLD('somedomain.com');
    fs.promises.stat.rejects({ code: 'ENOENT' });
    fs.promises.readFile.rejects({ code: 'ENOENT' });

    await delay(10);

    fs.promises.stat.rejects({ code: 'ENOENT' });
    request.returns(createMockErrorStream());
    await data.getTLD('somedomain.com');
  });

  it('does not yield an error if there is stale but not expired cached data on disk and data retrieval fails', async function () {
    request.returns(createMockErrorStream());
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).resolves({ mtime: new Date(Date.now() - 150000) });

    const data = new PublicSuffixData({ tts: 100, ttl: 200 });

    await data.getTLD('somedomain.com');
  });

  it('yields an error if there is expired cached data and data retrieval fails', async function () {
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).resolves({ mtime: new Date(Date.now() - 300000) });
    request.returns(createMockErrorStream());

    const data = new PublicSuffixData({ tts: 100, ttl: 200 });

    let caughtError = null;
    try {
      await data.getTLD('somedomain.com');
    } catch (err) {
      caughtError = err;
    }
    
    expect(caughtError).to.exist;
  });

  it('does not retrieve the list from the Internet if there is a non-stale cached file', function () {
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).resolves({ mtime: new Date() });

    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.not.been.called;
      });
  });

  it('retrieves the list from the Internet if there is a non-stale cached file that gets a read error', function () {
    fs.promises.stat.withArgs(sinon.match(/\.publicsuffix\.org$/)).resolves({ mtime: new Date() });
    fs.promises.readFile.rejects(new Error());

    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        expect(request).to.have.been.called;
      });
  });

  it('saves the retrieved list to the cache location', async function () {
    const cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.promises.stat.withArgs(cacheFile).rejects({ code: 'ENOENT' });

    const data = new PublicSuffixData();
    await data.getTLD('somedomain.com');
    await delay(1);

    expect(fs.promises.writeFile).to.have.been.calledWithMatch(cacheFile);
  });

  it('caches the TLDs to memory so subsequent disk reads or Internet fetches are not needed', function () {
    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function () {
        fs.promises.stat.reset();
        return data.getTLD('somethingelse.net');
      })
      .then(function () {
        expect(fs.promises.stat).to.have.not.been.called;
      })
  });

  it('returns data from memory when valid but stale, so fetch is performed out-of-band', async function () {
    this.timeout(5000);

    fs.promises.stat.rejects({ code: 'ENOENT' });
    request.returns(createMockStream('uk'));

    const data = new PublicSuffixData({ tts: 1, ttl: 1000000 });
    let tld = await data.getTLD('somedomain.co.uk');
    expect(tld).to.equal('uk');

    await delay(2000);

    request.returns(createMockStream('uk\nco.uk'));
    tld = await data.getTLD('somedomain.co.uk');
    expect(tld).to.equal('uk'); // We still serve up stale data

    await delay(1000);

    tld = await data.getTLD('somedomain.co.uk');
    expect(tld).to.equal('co.uk');
  });

  it('handles single-segment TLDs', function () {
    const cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.promises.stat.withArgs(cacheFile).rejects({ code: 'ENOENT' });
    request.returns(createMockStream('com'));

    const data = new PublicSuffixData();
    return data.getTLD('somedomain.com')
      .then(function (tld) {
        expect(tld).to.equal('com');
      });
  });

  it('handles two-segment TLDs', function () {
    const cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.promises.stat.withArgs(cacheFile).rejects({ code: 'ENOENT' });
    request.returns(createMockStream('co\nuk\nco.uk'));

    const data = new PublicSuffixData();
    return data.getTLD('foo.co.uk')
      .then(function (tld) {
        expect(tld).to.equal('co.uk');
      });
  });

  it('handles exception rules', function () {
    const cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.promises.stat.withArgs(cacheFile).rejects({ code: 'ENOENT' });
    request.returns(createMockStream('*.kawasaki.jp\n!city.kawasaki.jp'));

    const data = new PublicSuffixData();
    return data.getTLD('city.kawasaki.jp')
      .then(function (tld) {
        expect(tld).to.equal('kawasaki.jp');
      });
  });

  it('ignores comments', function () {
    const cacheFile = sinon.match(/\.publicsuffix\.org$/);
    fs.promises.stat.withArgs(cacheFile).rejects({ code: 'ENOENT' });
    request.returns(createMockStream('jp\n// jp geographic type names\n*.kawasaki.jp'));

    const data = new PublicSuffixData();
    return data.getTLD('foo.kawasaki.jp')
      .then(function (tld) {
        expect(tld).to.equal('foo.kawasaki.jp');
      });
  });

  function setup() {
    fs = {
      promises: {
        stat: sinon.stub().resolves({ mtime: new Date() }),
        readFile: sinon.stub().resolves('{}'),
        writeFile: sinon.stub().resolves()
      }
    };

    request = sinon.stub().returns(createMockStream(''));

    PublicSuffixData = proxyquire.noCallThru()('../../lib/public-suffix-data', {
      fs: fs,
      request: request
    });
  }

  function createMockStream(content) {
    const stream = new PassThroughStream();
    stream.end(content);
    return stream;
  }

  function createMockErrorStream() {
    const mockStream = new EventEmitter();
    mockStream.on = sinon.stub().withArgs('error').yields(new Error('Boom'));
    mockStream.pipe = function (writable) { return writable; };
    return mockStream;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
});
