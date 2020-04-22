const { expect } = require('chai');
const PublicSuffixData = require('../..');

describe('publicsuffix-data', function () {
  it('can detect one-segment TLDs', async function () {
    const data = new PublicSuffixData();

    const tld = await data.getTLD('example.com');

    expect(tld).to.equal('com');
  });

  it('can detect two-segment TLDs', async function () {
    const data = new PublicSuffixData();

    const tld = await data.getTLD('example.co.uk');

    expect(tld).to.equal('co.uk');
  });
});
