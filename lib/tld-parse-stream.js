const { Transform } = require('stream');

const isAComment = /^\/\//;

class TLDParseStream extends Transform {
  constructor() {
    super({ objectMode: true });
    this._buffer = '';
  }

  _transform(str, encoding, cb) {
    str = this._buffer + str;
    const lines = str.split('\n');
  
    // Ignore the last, which may be a partial line
    let i;
    for (i = 0; i < lines.length - 1; i++) {
      this._processLine(lines[i])
    }
  
    this._buffer = lines[i];
    cb();
  }
  
  _flush(cb) {
    this._processLine(this._buffer);
    cb();
  }
  
  _processLine(line) {
    line = line.trim().toLowerCase();
    if (line && !isAComment.test(line)) {
      this.push(line.split('.'));
    }
  }
}

module.exports = TLDParseStream;
