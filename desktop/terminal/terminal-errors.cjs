class TerminalError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "TerminalError";
    this.code = code;
    this.details = details;
  }
}

module.exports = { TerminalError };

