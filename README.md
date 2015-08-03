# publicsuffix-data

Module for accessing the publicsuffix.org database for TLDs

## Installing

Install using npm:

```bash
npm install --save publicsuffix-data
```

## Description

Maintains an infrequently-updated copy of the [Public Suffix List](https://publicsuffix.org/) and an API to query this
data.

Other modules for accessing static copies of the data already exist. See these modules if you do not need
an automatically-updating database:

- [publicsuffix](https://www.npmjs.com/package/publicsuffix)
- [public-suffix](https://www.npmjs.com/package/public-suffix)
- [psl](https://www.npmjs.com/package/psl)

## Usage

```javascript
var PublicSuffixData = require('publicsuffix-data');
var publicSuffixData = new PublicSuffixData({
  tts: timeToStaleInSeconds,    // Seconds until the next fetch of data will occur. Defaults to 10 days (864,000).
  ttl: timeToLiveInSeconds,     // Seconds until old data becomes invalid. Defaults to 30 days (2,592,000).
  cache: cacheFileLocation      // Defaults to ~/.publicsuffix.org
});

publicSuffixData.getTLD('foo.example.com', function (err, result) {
  console.log(result); // "com"
});
```
