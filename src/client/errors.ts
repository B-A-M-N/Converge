export class DaemonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonUnavailableError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ProtocolError extends Error {
  code: number;
  constructor(message: string, code: number = 1) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export class IncompatibleVersionError extends ProtocolError {
  constructor(message: string, public serverVersion: string, public clientVersion: string) {
    super(message, 2);
    this.name = 'IncompatibleVersionError';
  }
}
