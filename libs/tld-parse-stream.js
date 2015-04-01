module.exports = TLDParseStream;

var util = require('util');
var stream = require('stream');

util.inherits(TLDParseStream, stream.Transform);
function TLDParseStream() {
  stream.Transform.call(this, { objectMode: true });
  this._buffer = '';
}

var isAComment = /^\/\//;
TLDParseStream.prototype._transform = function (str, encoding, cb) {
  str = this._buffer + str;
  var lines = str.split('\n');

  // Ignore the last, which may be a partial line
  for (var i = 0; i < lines.length - 1; i++) {
    this._processLine(lines[i])
  }

  this._buffer = lines[i];
  cb();
};

TLDParseStream.prototype._flush = function (cb) {
  this._processLine(this._buffer);
  cb();
};

TLDParseStream.prototype._processLine = function (line) {
  line = line.trim().toLowerCase();
  if (line && !isAComment.test(line)) {
    this.push(line.split('.'));
  }
};
