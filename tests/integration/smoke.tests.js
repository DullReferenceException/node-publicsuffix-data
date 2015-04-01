var expect = require('chai').expect;

var PublicSuffixData = require('../..');

describe('publicsuffix-data', function () {
  it('can detect one-segment TLDs', function (done) {
    var data = new PublicSuffixData();

    data.getTLD('example.com', function (err, tld) {
      expect(err).to.not.exist;
      expect(tld).to.equal('com');
      done();
    });
  });

  it('can detect two-segment TLDs', function (done) {
    var data = new PublicSuffixData();

    data.getTLD('example.co.uk', function (err, tld) {
      expect(err).to.not.exist;
      expect(tld).to.equal('co.uk');
      done();
    });
  });
});
